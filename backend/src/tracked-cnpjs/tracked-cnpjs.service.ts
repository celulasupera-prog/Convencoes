import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrackedCnpjDto, UpdateTrackedCnpjDto } from './dto/tracked-cnpj.dto';

@Injectable()
export class TrackedCnpjsService {
  constructor(private prisma: PrismaService) {}

  private async ensureUserOrganization(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, organizationId: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.organizationId) {
      return user.organizationId;
    }

    const organization = await this.prisma.organization.create({
      data: {
        name: user.email ? `Organizacao de ${user.email}` : 'Organizacao Padrao',
        users: {
          connect: { id: user.id },
        },
      },
    });

    return organization.id;
  }

  async create(dto: CreateTrackedCnpjDto, userId: string) {
    const existing = await this.prisma.trackedCnpj.findUnique({
      where: { cnpj: dto.cnpj },
    });
    if (existing) {
      throw new ConflictException('CNPJ is already tracked');
    }

    const organizationId = await this.ensureUserOrganization(userId);

    return this.prisma.trackedCnpj.create({
      data: {
        cnpj: dto.cnpj.replace(/\D/g, ''),
        name: dto.name,
        employerUnionName: dto.employerUnionName,
        employerUnionCnpj: dto.employerUnionCnpj
          ? dto.employerUnionCnpj.replace(/\D/g, '')
          : undefined,
        laborUnionName: dto.laborUnionName,
        laborUnionCnpj: dto.laborUnionCnpj
          ? dto.laborUnionCnpj.replace(/\D/g, '')
          : undefined,
        organizationId,
      },
    });
  }

  async findAll(userId: string, organizationId?: string) {
    const userOrganizationId = await this.ensureUserOrganization(userId);

    return this.prisma.trackedCnpj.findMany({
      where: {
        organizationId: organizationId ?? userOrganizationId,
      },
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
      data: {
        ...dto,
        cnpj: dto.cnpj ? dto.cnpj.replace(/\D/g, '') : undefined,
        employerUnionCnpj: dto.employerUnionCnpj
          ? dto.employerUnionCnpj.replace(/\D/g, '')
          : undefined,
        laborUnionCnpj: dto.laborUnionCnpj
          ? dto.laborUnionCnpj.replace(/\D/g, '')
          : undefined,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.trackedCnpj.delete({ where: { id } });
  }
}
