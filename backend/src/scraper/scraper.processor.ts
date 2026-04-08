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
  private readonly mediatorUrls = [
    'https://www3.mte.gov.br/sistemas/mediador/consultarinstcoletivo',
    'http://www3.mte.gov.br/sistemas/mediador/ConsultarInstColetivo',
  ];

  async scrapeTrackedCnpj(tracked: TrackedCnpj): Promise<ParsedInstrument[]> {
    let browser: Browser | null = null;

    try {
      this.logger.log(`Processing CNPJ ${tracked.cnpj}`);
      browser = await chromium.launch({
        headless: true,
        args: ['--disable-dev-shm-usage', '--no-sandbox'],
      });
      const context = await browser.newContext({
        locale: 'pt-BR',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(120000);
      page.setDefaultTimeout(120000);

      const usedUrl = await this.openMediatorSearchPage(page);
      this.logger.log(`Mediator loaded from ${usedUrl}`);

      await page.waitForSelector('#nrCNPJ', { timeout: 30000 });
      await page.fill('#nrCNPJ', tracked.cnpj.replace(/\D/g, ''));
      await this.selectAllValidity(page);
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
      .locator('a[href*="Resumo/ResumoVisualizar"], a[href*="resumo/resumovisualizar"]')
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
      /(?:https?:\/\/www3\.mte\.gov\.br)?\/sistemas\/mediador\/(?:Resumo\/ResumoVisualizar|resumo\/resumovisualizar)[^"'\\s<>]*/gi,
    );

    return Array.from(
      new Set(
        (matches ?? []).map((match) =>
          match.startsWith('http')
            ? match
            : new URL(match, 'https://www3.mte.gov.br').toString(),
        ),
      ),
    );
  }

  private async openMediatorSearchPage(page: Page) {
    const errors: string[] = [];

    for (const url of this.mediatorUrls) {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 120000,
        });
        return url;
      } catch (error: any) {
        errors.push(`${url} => ${error.message}`);
      }
    }

    throw new Error(`Unable to open Mediador: ${errors.join(' | ')}`);
  }

  private async selectAllValidity(page: Page) {
    const selected = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      const target = selects.find((select) => {
        const labels = Array.from(select.options).map((option) =>
          option.textContent?.trim().toLowerCase() ?? '',
        );

        return (
          labels.some((label) => label === 'todos') &&
          labels.some((label) => label.includes('vigentes'))
        );
      });

      if (!target) {
        return false;
      }

      const option =
        Array.from(target.options).find(
          (item) => item.textContent?.trim().toLowerCase() === 'todos',
        ) ?? target.options[0];

      target.value = option.value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));

      return true;
    });

    if (!selected) {
      this.logger.warn('Validity filter select not found; continuing with portal defaults.');
    }
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
