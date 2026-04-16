import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MediadorSearchError, ScraperProcessor } from './scraper.processor';

class RunCancelledError extends Error {
  constructor(message = 'Consulta interrompida manualmente') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly staleRunThresholdMs = 15 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private scraperProcessor: ScraperProcessor,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async enqueueActiveCnpjs() {
    this.logger.log('Starting daily scraper job...');
    try {
      const organizations = await this.prisma.trackedCnpj.findMany({
        where: { isActive: true },
        select: { organizationId: true },
        distinct: ['organizationId'],
      });

      for (const item of organizations) {
        await this.startRunForOrganization(item.organizationId, 'cron');
      }
    } catch (err: any) {
      this.logger.warn(`Scraper cron skipped – Redis unavailable: ${err.message}`);
    }
  }

  async startManualRun(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });

    if (!user?.organizationId) {
      throw new NotFoundException('Usuario sem organizacao associada');
    }

    const run = await this.startRunForOrganization(user.organizationId, userId);

    return {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      message: 'Varredura iniciada com sucesso',
    };
  }

  async listRuns() {
    return this.prisma.searchRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
    });
  }

  async runLocalSweep() {
    const organizations = await this.prisma.trackedCnpj.findMany({
      where: { isActive: true },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });

    if (organizations.length === 0) {
      throw new NotFoundException('Nenhum CNPJ ativo para monitorar');
    }

    const results: Array<{ organizationId: string; runId: string }> = [];

    for (const item of organizations) {
      await this.forceFailRunningRuns(item.organizationId);

      const run = await this.startRunForOrganization(
        item.organizationId,
        'local-cli',
        true,
      );

      results.push({
        organizationId: item.organizationId,
        runId: run.id,
      });
    }

    return results;
  }

  async findRun(id: string) {
    const run = await this.prisma.searchRun.findUnique({
      where: { id },
    });

    if (!run) {
      throw new NotFoundException('Execucao nao encontrada');
    }

    return run;
  }

  async cancelRun(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });

    if (!user?.organizationId) {
      throw new NotFoundException('Usuario sem organizacao associada');
    }

    const run = await this.prisma.searchRun.findUnique({
      where: { id },
    });

    if (!run || !run.logs?.includes(`organization:${user.organizationId}`)) {
      throw new NotFoundException('Execucao nao encontrada');
    }

    if (run.status !== 'RUNNING') {
      return {
        id: run.id,
        status: run.status,
        message: 'A varredura ja foi finalizada',
      };
    }

    const cancellationLine = `cancelled:manual:${userId}:${new Date().toISOString()}`;
    const updatedLogs = [run.logs, cancellationLine, 'failed:Consulta interrompida manualmente']
      .filter(Boolean)
      .join('\n');

    const updatedRun = await this.prisma.searchRun.update({
      where: { id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        logs: updatedLogs,
      },
    });

    return {
      id: updatedRun.id,
      status: updatedRun.status,
      finishedAt: updatedRun.finishedAt,
      message: 'Varredura interrompida com sucesso',
    };
  }

  private async startRunForOrganization(
    organizationId: string,
    triggeredBy: string,
    waitForCompletion = false,
  ) {
    await this.failStaleRunningRuns(organizationId);

    const running = await this.prisma.searchRun.findFirst({
      where: {
        status: 'RUNNING',
        logs: {
          contains: `organization:${organizationId}`,
        },
      },
    });

    if (running) {
      throw new ConflictException('Ja existe uma varredura em andamento');
    }

    const activeCnpjs = await this.prisma.trackedCnpj.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (activeCnpjs.length === 0) {
      throw new NotFoundException('Nenhum CNPJ ativo para monitorar');
    }

    const run = await this.prisma.searchRun.create({
      data: {
        status: 'RUNNING',
        logs: [
          `organization:${organizationId}`,
          `triggeredBy:${triggeredBy}`,
          `queued:${activeCnpjs.length}`,
          'status:run-started',
        ].join('\n'),
      },
    });

    if (waitForCompletion) {
      await this.executeRun(run.id, organizationId);
    } else {
      void this.executeRun(run.id, organizationId);
    }

    return run;
  }

  private async executeRun(runId: string, organizationId: string) {
    const cnpjs = await this.prisma.trackedCnpj.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const logLines = [`organization:${organizationId}`];
    let newItems = 0;
    let updatedItems = 0;
    let totalItems = 0;

    try {
      for (const tracked of cnpjs) {
        await this.ensureRunActive(runId);
        logLines.push(`processing:${tracked.cnpj}`);
        logLines.push(`processing-item:${tracked.id}:${tracked.cnpj}`);
        await this.persistRunLog(runId, logLines);

        const scrapeResult = await this.scraperProcessor.scrapeTrackedCnpj(tracked);
        await this.ensureRunActive(runId);
        const items = scrapeResult.items;
        totalItems += items.length;
        logLines.push(`result-links:${tracked.cnpj}:items=${items.length}`);
        logLines.push(`result-item:${tracked.id}:items=${items.length}`);
        logLines.push(
          `filled-field-strategy:${scrapeResult.diagnostics.filledFieldStrategy ?? 'unknown'}`,
        );
        logLines.push(
          `submit-strategy:${scrapeResult.diagnostics.submitStrategy ?? 'unknown'}`,
        );
        logLines.push(`result-page-url:${scrapeResult.diagnostics.resultPageUrl}`);
        logLines.push(`result-page-title:${scrapeResult.diagnostics.resultPageTitle}`);
        logLines.push(
          `result-page-links:${scrapeResult.diagnostics.detectedLinks.length}`,
        );
        if (scrapeResult.diagnostics.detectedLinks.length > 0) {
          for (const link of scrapeResult.diagnostics.detectedLinks) {
            logLines.push(`result-link:${link}`);
          }
        }
        logLines.push(
          `result-page-snippet:${scrapeResult.diagnostics.resultTextSnippet}`,
        );
        if (scrapeResult.diagnostics.formSnapshot) {
          logLines.push(`form-snapshot:${scrapeResult.diagnostics.formSnapshot}`);
        }
        if (scrapeResult.diagnostics.ajaxResponseUrl) {
          logLines.push(
            `ajax-response-url:${scrapeResult.diagnostics.ajaxResponseUrl}`,
          );
        }
        if (typeof scrapeResult.diagnostics.ajaxResponseStatus === 'number') {
          logLines.push(
            `ajax-response-status:${scrapeResult.diagnostics.ajaxResponseStatus}`,
          );
        }
        if (typeof scrapeResult.diagnostics.ajaxAttemptCount === 'number') {
          logLines.push(
            `ajax-attempt-count:${scrapeResult.diagnostics.ajaxAttemptCount}`,
          );
        }
        if (scrapeResult.diagnostics.ajaxResponseSnippet) {
          logLines.push(
            `ajax-response-snippet:${scrapeResult.diagnostics.ajaxResponseSnippet}`,
          );
        }
        if (scrapeResult.diagnostics.debugArtifactBasePath) {
          logLines.push(
            `debug-artifact-base-path:${scrapeResult.diagnostics.debugArtifactBasePath}`,
          );
        }
        await this.persistRunLog(runId, logLines);

        for (const item of items) {
          await this.ensureRunActive(runId);
          const existing = await this.prisma.instrument.findUnique({
            where: { externalId: item.externalId },
          });

          await this.prisma.instrument.upsert({
            where: { externalId: item.externalId },
            update: {
              type: item.type,
              registerDate: item.registerDate,
              validityStart: item.validityStart,
              validityEnd: item.validityEnd,
              uf: item.uf,
              documentLink: item.documentLink,
              contentSummary: item.contentSummary,
              isNew: false,
              parties: {
                deleteMany: {},
                create: item.parties,
              },
            },
            create: {
              externalId: item.externalId,
              type: item.type,
              registerDate: item.registerDate,
              validityStart: item.validityStart,
              validityEnd: item.validityEnd,
              uf: item.uf,
              documentLink: item.documentLink,
              contentSummary: item.contentSummary,
              isNew: true,
              parties: {
                create: item.parties,
              },
            },
          });

          if (!existing) {
            newItems += 1;
            logLines.push(`saved:new:${item.externalId}`);
          } else {
            updatedItems += 1;
            logLines.push(`saved:update:${item.externalId}`);
          }

          await this.persistRunLog(runId, logLines);
        }

        logLines.push(`processed:${tracked.cnpj}:items=${items.length}`);
        logLines.push(`processed-item:${tracked.id}:items=${items.length}`);
        await this.persistRunLog(runId, logLines);
      }

      await this.ensureRunActive(runId);
      logLines.push(
        `completed:new=${newItems}:updated=${updatedItems}:total=${totalItems}`,
      );

      await this.prisma.searchRun.update({
        where: { id: runId },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          logs: logLines.join('\n'),
        },
      });
    } catch (error: any) {
      if (error instanceof RunCancelledError) {
        const currentRun = await this.prisma.searchRun.findUnique({
          where: { id: runId },
        });

        if (currentRun?.status === 'FAILED' && currentRun.finishedAt) {
          return;
        }

        logLines.push('failed:Consulta interrompida manualmente');
        await this.prisma.searchRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            logs: logLines.join('\n'),
          },
        });
        return;
      }

      if (error instanceof MediadorSearchError) {
        if (error.diagnostics.ajaxResponseUrl) {
          logLines.push(`ajax-response-url:${error.diagnostics.ajaxResponseUrl}`);
        }
        if (typeof error.diagnostics.ajaxResponseStatus === 'number') {
          logLines.push(
            `ajax-response-status:${error.diagnostics.ajaxResponseStatus}`,
          );
        }
        if (typeof error.diagnostics.ajaxAttemptCount === 'number') {
          logLines.push(
            `ajax-attempt-count:${error.diagnostics.ajaxAttemptCount}`,
          );
        }
        if (error.diagnostics.ajaxResponseSnippet) {
          logLines.push(
            `ajax-response-snippet:${error.diagnostics.ajaxResponseSnippet}`,
          );
        }
        if (error.diagnostics.debugArtifactBasePath) {
          logLines.push(
            `debug-artifact-base-path:${error.diagnostics.debugArtifactBasePath}`,
          );
        }
      }
      logLines.push(`failed:${error.message}`);

      await this.prisma.searchRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          logs: logLines.join('\n'),
        },
      });

      this.logger.error(`Run ${runId} failed: ${error.message}`);
    }
  }

  private async failStaleRunningRuns(organizationId: string) {
    const runningRuns = await this.prisma.searchRun.findMany({
      where: {
        status: 'RUNNING',
        logs: {
          contains: `organization:${organizationId}`,
        },
      },
    });

    const staleRuns = runningRuns.filter((run) => {
      const startedAt = new Date(run.startedAt).getTime();
      return Date.now() - startedAt > this.staleRunThresholdMs;
    });

    for (const run of staleRuns) {
      await this.prisma.searchRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          logs: `${run.logs ?? ''}\nforced-stop: stale run cleared automatically`,
        },
      });
    }
  }

  private async forceFailRunningRuns(organizationId: string) {
    const runningRuns = await this.prisma.searchRun.findMany({
      where: {
        status: 'RUNNING',
        logs: {
          contains: `organization:${organizationId}`,
        },
      },
    });

    for (const run of runningRuns) {
      await this.prisma.searchRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          logs: `${run.logs ?? ''}\nforced-stop: replaced by local cli run`,
        },
      });
    }
  }

  private async persistRunLog(runId: string, logLines: string[]) {
    await this.prisma.searchRun.update({
      where: { id: runId },
      data: {
        logs: logLines.join('\n'),
      },
    });
  }

  private async ensureRunActive(runId: string) {
    const run = await this.prisma.searchRun.findUnique({
      where: { id: runId },
      select: { status: true, logs: true },
    });

    if (!run || run.status !== 'RUNNING' || run.logs?.includes('cancelled:manual:')) {
      throw new RunCancelledError();
    }
  }
}
