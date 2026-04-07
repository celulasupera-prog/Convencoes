import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(
    @InjectQueue('scraper') private scraperQueue: Queue,
    private prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async enqueueActiveCnpjs() {
    this.logger.log('Starting daily scraper enqueue job...');
    try {
      const run = await this.prisma.searchRun.create({
        data: { status: 'RUNNING' },
      });

      const activeCnpjs = await this.prisma.trackedCnpj.findMany({
        where: { isActive: true },
      });

      for (const tracked of activeCnpjs) {
        await this.scraperQueue.add(
          'scrape-cnpj',
          { cnpj: tracked.cnpj, runId: run.id },
          {
            jobId: `run-${run.id}-cnpj-${tracked.cnpj}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        );
      }

      this.logger.log(`Enqueued ${activeCnpjs.length} CNPJs for processing.`);
    } catch (err: any) {
      this.logger.warn(`Scraper cron skipped – Redis unavailable: ${err.message}`);
    }
  }
}

