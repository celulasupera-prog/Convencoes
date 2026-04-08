import { Injectable, Logger } from '@nestjs/common';
import { PartyRole, TrackedCnpj } from '@prisma/client';
import { Browser, Page, chromium } from 'playwright';

type ParsedInstrument = {
  externalId: string;
  type: string;
  registerDate?: Date;
  validityStart?: Date;
  validityEnd?: Date;
  uf?: string;
  documentLink?: string;
  contentSummary?: string;
  parties: Array<{
    name: string;
    cnpj?: string;
    role: PartyRole;
  }>;
};

@Injectable()
export class ScraperProcessor {
  private readonly logger = new Logger(ScraperProcessor.name);

  async scrapeTrackedCnpj(tracked: TrackedCnpj): Promise<ParsedInstrument[]> {
    let browser: Browser | null = null;

    try {
      this.logger.log(`Processing CNPJ ${tracked.cnpj}`);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(
        'https://www3.mte.gov.br/sistemas/mediador/consultarinstcoletivo',
        { waitUntil: 'domcontentloaded', timeout: 60000 },
      );

      await page.waitForSelector('#nrCNPJ', { timeout: 30000 });
      await page.fill('#nrCNPJ', tracked.cnpj.replace(/\D/g, ''));
      await page.click('input[name="btnPesquisar"]');
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(
        () => undefined,
      );
      await page.waitForTimeout(1500);

      const resultLinks = await this.extractResultLinks(page);
      const parsedItems: ParsedInstrument[] = [];

      for (const link of resultLinks) {
        const detailPage = await context.newPage();

        try {
          await detailPage.goto(link, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          parsedItems.push(await this.parseDetailPage(detailPage, link, tracked));
        } finally {
          await detailPage.close();
        }
      }

      this.logger.log(
        `Finished processing CNPJ ${tracked.cnpj} with ${parsedItems.length} item(s)`,
      );

      return parsedItems;
    } catch (error: any) {
      this.logger.error(`Error processing CNPJ ${tracked.cnpj}: ${error.message}`);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private async extractResultLinks(page: Page) {
    const hrefs = await page
      .locator('a[href*="Resumo/ResumoVisualizar"]')
      .evaluateAll((links: HTMLAnchorElement[]) =>
        links
          .map((link) => link.href)
          .filter((href) => typeof href === 'string' && href.length > 0),
      )
      .catch(() => []);

    if (hrefs.length > 0) {
      return Array.from(new Set(hrefs));
    }

    const html = await page.content();
    const matches = html.match(
      /https:\/\/www3\.mte\.gov\.br\/sistemas\/mediador\/Resumo\/ResumoVisualizar[^"'\\s<>]*/g,
    );

    return Array.from(new Set(matches ?? []));
  }

  private async parseDetailPage(
    page: Page,
    link: string,
    tracked: TrackedCnpj,
  ): Promise<ParsedInstrument> {
    await page.waitForSelector('body', { timeout: 30000 });

    const text = await page.locator('body').innerText();
    const title = await page.title();
    const summary = text.replace(/\s+/g, ' ').trim().slice(0, 4000);
    const url = new URL(link);
    const externalId = decodeURIComponent(
      url.searchParams.get('NrSolicitacao') || tracked.cnpj,
    ).replace(/\//g, '-');

    const validity = this.extractDateRange(
      text,
      /VIG[ÊE]NCIA(?:\s+DO\s+INSTRUMENTO)?[:\s]+(\d{2}\/\d{2}\/\d{4}).{0,20}?(\d{2}\/\d{2}\/\d{4})/is,
    );

    return {
      externalId,
      type: this.extractType(title, text),
      registerDate: this.extractDate(
        text,
        /DATA DE REGISTRO NO MTE:\s*(\d{2}\/\d{2}\/\d{4})/i,
      ),
      validityStart: validity?.start,
      validityEnd: validity?.end,
      uf: text.match(
        /\b([A-Z]{2})\b(?=\s+MUNICIPAL|\s+ESTADUAL|\s+INTERESTADUAL)/,
      )?.[1],
      documentLink: link,
      contentSummary: summary,
      parties: [
        {
          name: tracked.name || `CNPJ ${tracked.cnpj}`,
          cnpj: tracked.cnpj,
          role: 'COMPANY',
        },
      ],
    };
  }

  private extractType(title: string, text: string) {
    const fromTitle = title.match(
      /Extrato\s+(Acordo Coletivo|Convenção Coletiva|Termo Aditivo)/i,
    );

    if (fromTitle) {
      return fromTitle[1];
    }

    return (
      text.match(/(Acordo Coletivo|Convenção Coletiva|Termo Aditivo)/i)?.[1] ??
      'Instrumento Coletivo'
    );
  }

  private extractDate(text: string, regex: RegExp) {
    const match = text.match(regex);
    if (!match?.[1]) {
      return undefined;
    }

    return this.parseBrazilianDate(match[1]);
  }

  private extractDateRange(text: string, regex: RegExp) {
    const match = text.match(regex);
    if (!match?.[1] || !match?.[2]) {
      return undefined;
    }

    return {
      start: this.parseBrazilianDate(match[1]),
      end: this.parseBrazilianDate(match[2]),
    };
  }

  private parseBrazilianDate(value: string) {
    const [day, month, year] = value.split('/').map(Number);
    if (!day || !month || !year) {
      return undefined;
    }

    return new Date(Date.UTC(year, month - 1, day));
  }
}
