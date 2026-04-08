import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ScraperService } from './scraper/scraper.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  try {
    const scraperService = app.get(ScraperService);
    const runs = await scraperService.runLocalSweep();

    console.log('Local scraper finished successfully.');
    for (const run of runs) {
      console.log(
        `Organization ${run.organizationId} processed with run ${run.runId}.`,
      );
    }
  } catch (error: any) {
    console.error('Local scraper failed:', error.message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void bootstrap();
