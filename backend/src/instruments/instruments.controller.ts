import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { InstrumentsService } from './instruments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Get()
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('cnpj') cnpj?: string,
    @Query('isNew') isNew?: string,
    @Query('uf') uf?: string,
  ) {
    return this.instrumentsService.findAll({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      cnpj,
      isNew: isNew ? isNew === 'true' : undefined,
      uf,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.instrumentsService.findOne(id);
  }
}
