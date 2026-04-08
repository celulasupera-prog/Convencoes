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

      await this.fillCnpjField(page, tracked.cnpj.replace(/\D/g, ''));
      await this.selectAllValidity(page);
      await this.submitSearch(page);
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
      const normalize = (value: string | null | undefined) =>
        (value ?? '')
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()
          .trim();

      const labels = Array.from(document.querySelectorAll('label'));

      for (const label of labels) {
        if (!normalize(label.textContent).includes('vigencia')) {
          continue;
        }

        const htmlFor = label.getAttribute('for');
        const relatedByFor = htmlFor
          ? document.getElementById(htmlFor)
          : null;
        const relatedByContainer = label.parentElement?.querySelector('select');
        const target =
          (relatedByFor instanceof HTMLSelectElement ? relatedByFor : null) ??
          (relatedByContainer instanceof HTMLSelectElement
            ? relatedByContainer
            : null);

        if (!target) {
          continue;
        }

        const option = Array.from(target.options).find(
          (item) => normalize(item.textContent) === 'todos',
        );

        if (!option) {
          continue;
        }

        target.value = option.value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      const fallback = Array.from(document.querySelectorAll('select')).find(
        (select) => {
          const labels = Array.from(select.options).map((option) =>
            normalize(option.textContent),
          );

          return (
            labels.includes('todos') &&
            labels.includes('vigentes') &&
            labels.includes('nao vigentes')
          );
        },
      );

      if (!(fallback instanceof HTMLSelectElement)) {
        return false;
      }

      const option = Array.from(fallback.options).find(
        (item) => normalize(item.textContent) === 'todos',
      );

      if (!option) {
        return false;
      }

      fallback.value = option.value;
      fallback.dispatchEvent(new Event('input', { bubbles: true }));
      fallback.dispatchEvent(new Event('change', { bubbles: true }));

      return true;
    });

    if (!selected) {
      this.logger.warn('Validity filter select not found; continuing with portal defaults.');
    }
  }

  private async fillCnpjField(page: Page, cnpj: string) {
    const filledByLabel = await page
      .getByLabel(/CNPJ/i)
      .fill(cnpj)
      .then(() => true)
      .catch(() => false);

    if (filledByLabel) {
      return;
    }

    const filledByDom = await page.evaluate((cnpjValue) => {
      const normalize = (value: string | null | undefined) =>
        (value ?? '')
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()
          .trim();

      const labels = Array.from(document.querySelectorAll('label'));

      for (const label of labels) {
        if (normalize(label.textContent) !== 'cnpj:') {
          continue;
        }

        const htmlFor = label.getAttribute('for');
        const relatedByFor = htmlFor
          ? document.getElementById(htmlFor)
          : null;
        const relatedByContainer = label.parentElement?.querySelector('input');
        const target =
          (relatedByFor instanceof HTMLInputElement ? relatedByFor : null) ??
          (relatedByContainer instanceof HTMLInputElement
            ? relatedByContainer
            : null);

        if (!target) {
          continue;
        }

        target.value = cnpjValue;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      const fallback = Array.from(
        document.querySelectorAll('input[type="text"], input:not([type])'),
      ).find((input) => {
        const element = input as HTMLInputElement;
        const attrs = [
          element.name,
          element.id,
          element.getAttribute('placeholder'),
          element.getAttribute('aria-label'),
        ]
          .map(normalize)
          .join(' ');

        return attrs.includes('cnpj');
      }) as HTMLInputElement | undefined;

      if (!fallback) {
        return false;
      }

      fallback.value = cnpjValue;
      fallback.dispatchEvent(new Event('input', { bubbles: true }));
      fallback.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, cnpj);

    if (!filledByDom) {
      throw new Error('CNPJ field not found on Mediador page');
    }
  }

  private async submitSearch(page: Page) {
    const clickedByRole = await page
      .getByRole('button', { name: /Pesquisar/i })
      .click()
      .then(() => true)
      .catch(() => false);

    if (clickedByRole) {
      return;
    }

    const clickedByDom = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll('input[type="submit"], button, input[type="button"]'),
      );

      const target = candidates.find((element) =>
        /pesquisar/i.test(
          (element.textContent ?? '') ||
            element.getAttribute('value') ||
            element.getAttribute('aria-label') ||
            '',
        ),
      ) as HTMLButtonElement | HTMLInputElement | undefined;

      if (!target) {
        return false;
      }

      target.click();
      return true;
    });

    if (!clickedByDom) {
      throw new Error('Search button not found on Mediador page');
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
