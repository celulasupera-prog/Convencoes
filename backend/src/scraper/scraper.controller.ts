import {
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ScraperService } from './scraper.service';

@UseGuards(JwtAuthGuard)
@Controller('scraper')
export class ScraperController {
  constructor(private readonly scraperService: ScraperService) {}

  @Post('runs')
  startManualRun(@Request() req: any) {
    return this.scraperService.startManualRun(req.user.id);
  }

  @Get('runs')
  listRuns() {
    return this.scraperService.listRuns();
  }

  @Get('runs/:id')
  findRun(@Param('id') id: string) {
    return this.scraperService.findRun(id);
  }

  @Post('runs/:id/cancel')
  cancelRun(@Param('id') id: string, @Request() req: any) {
    return this.scraperService.cancelRun(id, req.user.id);
  }
}
