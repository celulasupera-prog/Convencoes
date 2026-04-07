import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { chromium, Browser } from 'playwright';
import { PrismaService } from '../prisma/prisma.service';

@Processor('scraper')
export class ScraperProcessor extends WorkerHost {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { cnpj, runId } = job.data;
    this.logger.log(`Processing CNPJ ${cnpj} (Run: ${runId})`);

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      // Placeholder snippet for the MTE Mediator flow
      await page.goto('http://www3.mte.gov.br/sistemas/mediador/ConsultarInstColetivo');
      
      const cnpjDigits = cnpj.replace(/\D/g, '');
      await page.waitForSelector('#nrCNPJ');
      await page.fill('#nrCNPJ', cnpjDigits);
      
      await page.click('input[name="btnPesquisar"]');
      
      // Typically wait for results table or empty message
      await page.waitForTimeout(3000); 

      // Example dummy parse result
      const newItemsMock: any[] = [];

      for (const item of newItemsMock) {
        await this.prisma.instrument.upsert({
          where: { externalId: item.externalId },
          update: { },
          create: {
            externalId: item.externalId,
            type: item.type,
            registerDate: item.registerDate,
            isNew: true,
          }
        });
      }

      this.logger.log(`Finished processing CNPJ ${cnpj}`);
      return { success: true, parsed: newItemsMock.length };
    } catch (error) {
      this.logger.error(`Error processing CNPJ ${cnpj}: ${error.message}`);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
