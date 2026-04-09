import { mkdir, writeFile } from 'fs/promises';
import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
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

type ScrapeDiagnostics = {
  resultPageUrl: string;
  resultPageTitle: string;
  resultTextSnippet: string;
  detectedLinks: string[];
  filledFieldStrategy?: string;
  submitStrategy?: string;
  formSnapshot?: string;
  debugArtifactBasePath?: string;
  ajaxResponseUrl?: string;
  ajaxResponseStatus?: number;
  ajaxResponseSnippet?: string;
  ajaxAttemptCount?: number;
};

type ScrapeTrackedCnpjResult = {
  items: ParsedInstrument[];
  diagnostics: ScrapeDiagnostics;
};

type SearchSubmissionResult = {
  strategy: string;
  ajaxResponseHtml?: string;
  ajaxResponseStatus?: number;
  ajaxResponseUrl?: string;
  attemptCount?: number;
};

export class MediadorSearchError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: ScrapeDiagnostics,
  ) {
    super(message);
    this.name = 'MediadorSearchError';
  }
}

@Injectable()
export class ScraperProcessor {
  private readonly logger = new Logger(ScraperProcessor.name);
  private readonly maxAjaxAttempts = 3;
  private readonly mediatorUrls = [
    'https://www3.mte.gov.br/sistemas/mediador/consultarinstcoletivo',
    'http://www3.mte.gov.br/sistemas/mediador/ConsultarInstColetivo',
  ];

  async scrapeTrackedCnpj(
    tracked: TrackedCnpj,
  ): Promise<ScrapeTrackedCnpjResult> {
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

      const filledFieldStrategy = await this.fillCnpjField(
        page,
        tracked.cnpj.replace(/\D/g, ''),
      );
      await this.selectActiveValidity(page);
      const submitResult = await this.submitSearch(page);
      await this.waitForSearchToSettle(page, submitResult.ajaxResponseHtml);

      const resultLinks = await this.extractResultLinks(
        page,
        submitResult.ajaxResponseHtml,
      );
      const diagnostics = await this.collectDiagnostics(
        page,
        resultLinks,
        filledFieldStrategy,
        submitResult,
      );
      if (resultLinks.length === 0) {
        diagnostics.debugArtifactBasePath = await this.saveDebugArtifacts(
          page,
          tracked.cnpj,
        );
      }
      this.ensureSuccessfulSearch(diagnostics, resultLinks.length);
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

      return {
        items: parsedItems,
        diagnostics,
      };
    } catch (error: any) {
      this.logger.error(`Error processing CNPJ ${tracked.cnpj}: ${error.message}`);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private async extractResultLinks(page: Page, ajaxResponseHtml?: string) {
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

    if (ajaxResponseHtml) {
      const ajaxMatches = this.extractResultLinksFromHtml(ajaxResponseHtml);
      if (ajaxMatches.length > 0) {
        return ajaxMatches;
      }
    }

    const html = await page.content();
    return this.extractResultLinksFromHtml(html);
  }

  private async collectDiagnostics(
    page: Page,
    detectedLinks: string[],
    filledFieldStrategy?: string,
    submitResult?: SearchSubmissionResult,
  ): Promise<ScrapeDiagnostics> {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const formSnapshot = await page.evaluate(() => {
      const normalize = (value: string | null | undefined) =>
        (value ?? '').replace(/\s+/g, ' ').trim();

      const controls = Array.from(
        document.querySelectorAll('input, select, button, a'),
      )
        .slice(0, 40)
        .map((element) => {
          const tag = element.tagName.toLowerCase();
          const inputValue =
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement
              ? normalize(element.value)
              : '';
          const checked =
            element instanceof HTMLInputElement ? String(element.checked) : '';
          const attrs = [
            `tag=${tag}`,
            `type=${element.getAttribute('type') ?? ''}`,
            `id=${element.id ?? ''}`,
            `name=${element.getAttribute('name') ?? ''}`,
            `value=${normalize(element.getAttribute('value'))}`,
            `liveValue=${inputValue}`,
            `checked=${checked}`,
            `text=${normalize(element.textContent)}`,
            `title=${normalize(element.getAttribute('title'))}`,
            `alt=${normalize(element.getAttribute('alt'))}`,
          ];

          return attrs.join('|');
        });

      return controls.join(' || ');
    });

    return {
      resultPageUrl: page.url(),
      resultPageTitle: await page.title().catch(() => ''),
      resultTextSnippet: bodyText.replace(/\s+/g, ' ').trim().slice(0, 1200),
      detectedLinks: detectedLinks.slice(0, 10),
      filledFieldStrategy,
      submitStrategy: submitResult?.strategy,
      formSnapshot,
      ajaxResponseUrl: submitResult?.ajaxResponseUrl,
      ajaxResponseStatus: submitResult?.ajaxResponseStatus,
      ajaxResponseSnippet: submitResult?.ajaxResponseHtml
        ? this.toSnippet(this.htmlToText(submitResult.ajaxResponseHtml))
        : undefined,
      ajaxAttemptCount: submitResult?.attemptCount,
    };
  }

  private async saveDebugArtifacts(page: Page, cnpj: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseDir = join(process.cwd(), 'debug', 'mediador');
    const basePath = join(baseDir, `${timestamp}-${cnpj}`);
    const html = await page.content().catch(() => '');
    const text = await page.locator('body').innerText().catch(() => '');

    await mkdir(baseDir, { recursive: true });
    await writeFile(`${basePath}.html`, html, 'utf-8');
    await writeFile(`${basePath}.txt`, text, 'utf-8');
    await page.screenshot({
      path: `${basePath}.png`,
      fullPage: true,
    });

    return basePath;
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

  private async selectActiveValidity(page: Page) {
    const knownSelect = page.locator('#cboSTVigencia');
    if ((await knownSelect.count()) > 0) {
      await knownSelect.selectOption({ label: 'Vigentes' }).catch(() => null);
      const selectedValue = await knownSelect.inputValue().catch(() => '');
      if (selectedValue) {
        return;
      }
    }

    const selectedByKnownId = await page.evaluate(() => {
      const select = document.getElementById('cboSTVigencia');
      if (!(select instanceof HTMLSelectElement)) {
        return false;
      }

      const option = Array.from(select.options).find(
        (item) =>
          (item.textContent ?? '')
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .toLowerCase()
            .trim() === 'vigentes',
      );

      if (!option) {
        return false;
      }

      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });

    if (selectedByKnownId) {
      return;
    }

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
          (item) => normalize(item.textContent) === 'vigentes',
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
        (item) => normalize(item.textContent) === 'vigentes',
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
    const knownCheckbox = page.locator('#chkNRCNPJ');
    const knownInput = page.locator('#txtNRCNPJ');
    if ((await knownCheckbox.count()) > 0 && (await knownInput.count()) > 0) {
      await knownCheckbox.check().catch(async () => {
        await knownCheckbox.click();
      });
      await knownInput.fill(cnpj);
      const currentValue = await knownInput.inputValue().catch(() => '');
      if (currentValue.replace(/\D/g, '') === cnpj) {
        return 'known-id-playwright';
      }
    }

    const filledByKnownId = await page.evaluate((cnpjValue) => {
      const checkbox = document.getElementById('chkNRCNPJ');
      const input = document.getElementById('txtNRCNPJ');

      if (!(checkbox instanceof HTMLInputElement) || !(input instanceof HTMLInputElement)) {
        return null;
      }

      checkbox.checked = true;
      checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));

      input.focus();
      input.value = cnpjValue;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'known-id';
    }, cnpj);

    if (filledByKnownId) {
      return filledByKnownId;
    }

    const filledByLabel = await page
      .getByLabel(/CNPJ/i)
      .fill(cnpj)
      .then(() => 'label')
      .catch(() => null);

    if (filledByLabel) {
      return filledByLabel;
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
        return 'dom-label';
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
      return 'dom-attr';
    }, cnpj);

    if (!filledByDom) {
      const filledByPosition = await page.evaluate((cnpjValue) => {
        const visibleInputs = Array.from(
          document.querySelectorAll('input[type="text"], input:not([type])'),
        ).filter((input) => {
          const element = input as HTMLInputElement;
          const style = window.getComputedStyle(element);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            !element.disabled &&
            element.type !== 'hidden'
          );
        }) as HTMLInputElement[];

        const target = visibleInputs[0];
        if (!target) {
          return null;
        }

        target.focus();
        target.value = cnpjValue;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return 'dom-position';
      }, cnpj);

      if (!filledByPosition) {
        throw new Error('CNPJ field not found on Mediador page');
      }

      return filledByPosition;
    }

    return filledByDom;
  }

  private async submitSearch(page: Page): Promise<SearchSubmissionResult> {
    let lastResult: SearchSubmissionResult | null = null;

    for (let attempt = 1; attempt <= this.maxAjaxAttempts; attempt += 1) {
      const responsePromise = page
        .waitForResponse(
          (response) =>
            /\/ConsultarInstColetivo\/getConsultaAvancada/i.test(response.url()) &&
            response.request().method().toUpperCase() === 'POST',
          { timeout: 45000 },
        )
        .catch(() => null);

      const strategy = await this.triggerSearch(page);
      const ajaxResponse = await responsePromise;

      if (ajaxResponse) {
        await page.waitForTimeout(1500);
      }

      lastResult = {
        strategy:
          attempt === 1 ? strategy : `${strategy}:attempt-${attempt}`,
        ajaxResponseHtml: await ajaxResponse?.text().catch(() => undefined),
        ajaxResponseStatus: ajaxResponse?.status(),
        ajaxResponseUrl: ajaxResponse?.url(),
        attemptCount: attempt,
      };

      if (!this.shouldRetrySubmission(lastResult)) {
        return lastResult;
      }

      this.logger.warn(
        `Mediator returned retryable response on attempt ${attempt}: ${lastResult.ajaxResponseStatus ?? 'no-status'}`,
      );
      await page.waitForTimeout(2500 * attempt);
    }

    return (
      lastResult ?? {
        strategy: 'unknown',
        attemptCount: this.maxAjaxAttempts,
      }
    );
  }

  private async triggerSearch(page: Page) {
    const submittedByScript = await page
      .evaluate(async () => {
        const execute = (window as any).executeRecaptcha;
        const search = (window as any).funcHandlerBtnPesquisar;

        if (typeof execute !== 'function' || typeof search !== 'function') {
          return null;
        }

        await execute();
        search(false);
        return 'js-function-recaptcha';
      })
      .catch(() => null);

    if (submittedByScript) {
      return submittedByScript;
    }

    const knownButton = page.locator('#btnPesquisar, input[name="btnPesquisar"]');
    if ((await knownButton.count()) > 0) {
      await knownButton.first().click();
      return 'known-control-playwright';
    }

    const submittedByKnownId = await page.evaluate(() => {
      const directSelectors = [
        '#btnPesquisar',
        'input[name="btnPesquisar"]',
        'input[id*="Pesquisar"]',
        'input[value*="Pesquisar"]',
        'input[type="image"][alt*="Pesquisar"]',
        'input[type="image"][title*="Pesquisar"]',
      ];

      for (const selector of directSelectors) {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
          continue;
        }

        element.click();
        return `known-control:${selector}`;
      }

      const input = document.getElementById('txtNRCNPJ');
      const form = input?.closest('form');
      if (form instanceof HTMLFormElement) {
        form.submit();
        return 'known-form-submit';
      }

      return null;
    });

    if (submittedByKnownId) {
      return submittedByKnownId;
    }

    const clickedByRole = await page
      .getByRole('button', { name: /Pesquisar/i })
      .click()
      .then(() => 'role-button')
      .catch(() => null);

    if (clickedByRole) {
      return clickedByRole;
    }

    const clickedByDom = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll(
          'input[type="submit"], input[type="button"], input[type="image"], button, a',
        ),
      );

      const target = candidates.find((element) =>
        /pesquisar/i.test(
          (element.textContent ?? '') ||
            element.getAttribute('value') ||
            element.getAttribute('aria-label') ||
            element.getAttribute('title') ||
            element.getAttribute('alt') ||
            '',
        ),
      ) as HTMLButtonElement | HTMLInputElement | HTMLAnchorElement | undefined;

      if (!target) {
        return null;
      }

      target.click();
      return `dom-click:${target.tagName.toLowerCase()}:${target.getAttribute('type') ?? ''}`;
    });

    if (clickedByDom) {
      return clickedByDom;
    }

    const pressedEnter = await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll('input[type="text"], input:not([type])'),
      ).filter((input) => {
        const element = input as HTMLInputElement;
        const style = window.getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          !element.disabled &&
          element.type !== 'hidden'
        );
      }) as HTMLInputElement[];

      const target = inputs[0];
      if (!target) {
        return null;
      }

      target.focus();
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
      });
      target.dispatchEvent(event);
      return 'keyboard-enter';
    });

    if (pressedEnter) {
      return pressedEnter;
    }

    const submittedForm = await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll('form'));
      const target = forms.find((form) =>
        /consultar instrumentos coletivos registrados/i.test(
          form.textContent ?? '',
        ),
      );

      if (!target) {
        return null;
      }

      (target as HTMLFormElement).submit();
      return 'form-submit';
    });

    if (!submittedForm) {
      throw new Error('Search button not found on Mediador page');
    }

    return submittedForm;
  }

  private async waitForSearchToSettle(page: Page, ajaxResponseHtml?: string) {
    if (ajaxResponseHtml) {
      await page.waitForFunction(
        () => {
          const detail = document.getElementById('divConsultaDetalhada');
          const detailHtml = detail?.innerHTML?.trim() ?? '';
          const wrapper = document.getElementById('divExibirConsultaDetalhada');
          const wrapperVisible =
            wrapper instanceof HTMLElement &&
            getComputedStyle(wrapper).display !== 'none';

          return detailHtml.length > 0 || wrapperVisible;
        },
        { timeout: 10000 },
      ).catch(() => undefined);

      return;
    }

    await page.waitForTimeout(3000);
  }

  private shouldRetrySubmission(result: SearchSubmissionResult) {
    const status = result.ajaxResponseStatus;
    const snippet = this.toSnippet(this.htmlToText(result.ajaxResponseHtml ?? ''));

    return (
      typeof status === 'number' &&
      status >= 500 &&
      /wait operation timed out|execution timeout expired|server error/i.test(
        snippet,
      )
    );
  }

  private ensureSuccessfulSearch(
    diagnostics: ScrapeDiagnostics,
    resultCount: number,
  ) {
    if (resultCount > 0) {
      return;
    }

    const status = diagnostics.ajaxResponseStatus;
    const snippet = diagnostics.ajaxResponseSnippet ?? '';

    if (
      typeof status === 'number' &&
      status >= 500 &&
      /wait operation timed out|execution timeout expired|server error/i.test(
        snippet,
      )
    ) {
      throw new MediadorSearchError(
        `Falha no portal do MTE: consulta retornou ${status} com timeout interno do servidor`,
        diagnostics,
      );
    }
  }

  private extractResultLinksFromHtml(html: string) {
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

  private htmlToText(html: string) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private toSnippet(value: string) {
    return value.replace(/\s+/g, ' ').trim().slice(0, 1200);
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
