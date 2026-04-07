import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrackedCnpjDto, UpdateTrackedCnpjDto } from './dto/tracked-cnpj.dto';

@Injectable()
export class TrackedCnpjsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTrackedCnpjDto) {
    const existing = await this.prisma.trackedCnpj.findUnique({
      where: { cnpj: dto.cnpj },
    });
    if (existing) {
      throw new ConflictException('CNPJ is already tracked');
    }

    return this.prisma.trackedCnpj.create({
      data: {
        cnpj: dto.cnpj,
        name: dto.name,
        organizationId: dto.organizationId,
      },
    });
  }

  async findAll(organizationId?: string) {
    return this.prisma.trackedCnpj.findMany({
      where: organizationId ? { organizationId } : undefined,
    });
  }

  async findOne(id: string) {
    const cnpj = await this.prisma.trackedCnpj.findUnique({ where: { id } });
    if (!cnpj) throw new NotFoundException('Tracked CNPJ not found');
    return cnpj;
  }

  async update(id: string, dto: UpdateTrackedCnpjDto) {
    await this.findOne(id);
    return this.prisma.trackedCnpj.update({
      where: { id },
      data: dto as any,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.trackedCnpj.delete({ where: { id } });
  }
}
