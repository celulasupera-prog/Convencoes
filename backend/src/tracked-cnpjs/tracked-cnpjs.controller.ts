import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Query, Request } from '@nestjs/common';
import { TrackedCnpjsService } from './tracked-cnpjs.service';
import { CreateTrackedCnpjDto, UpdateTrackedCnpjDto } from './dto/tracked-cnpj.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('tracked-cnpjs')
export class TrackedCnpjsController {
  constructor(private readonly trackedCnpjsService: TrackedCnpjsService) {}

  @Post()
  create(@Body() createDto: CreateTrackedCnpjDto, @Request() req: any) {
    return this.trackedCnpjsService.create(createDto, req.user.id);
  }

  @Get()
  findAll(@Query('organizationId') organizationId: string | undefined, @Request() req: any) {
    return this.trackedCnpjsService.findAll(req.user.id, organizationId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.trackedCnpjsService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateTrackedCnpjDto) {
    return this.trackedCnpjsService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.trackedCnpjsService.remove(id);
  }
}
