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
    const baseEmployerUnionCnpj =
      dto.employerUnionCnpj?.replace(/\D/g, '') ?? dto.cnpj.replace(/\D/g, '');
    const baseEmployerUnionName = dto.employerUnionName ?? dto.name;
    const normalizedLaborUnionCnpj = dto.laborUnionCnpj
      ? dto.laborUnionCnpj.replace(/\D/g, '')
      : undefined;
    const organizationId = await this.ensureUserOrganization(userId);

    const existing = await this.prisma.trackedCnpj.findFirst({
      where: {
        organizationId,
        employerUnionCnpj: baseEmployerUnionCnpj,
        laborUnionCnpj: normalizedLaborUnionCnpj,
      },
    });
    if (existing) {
      throw new ConflictException('Esta dupla sindical ja esta cadastrada');
    }

    return this.prisma.trackedCnpj.create({
      data: {
        cnpj: baseEmployerUnionCnpj,
        name: baseEmployerUnionName,
        employerUnionName: baseEmployerUnionName,
        employerUnionCnpj: baseEmployerUnionCnpj,
        laborUnionName: dto.laborUnionName,
        laborUnionCnpj: normalizedLaborUnionCnpj,
        baseMonth: dto.baseMonth,
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
    const current = await this.findOne(id);

    const baseEmployerUnionCnpj = dto.employerUnionCnpj
      ? dto.employerUnionCnpj.replace(/\D/g, '')
      : dto.cnpj
        ? dto.cnpj.replace(/\D/g, '')
        : current.employerUnionCnpj ?? current.cnpj;
    const baseEmployerUnionName = dto.employerUnionName ?? dto.name;
    const normalizedLaborUnionCnpj = dto.laborUnionCnpj
      ? dto.laborUnionCnpj.replace(/\D/g, '')
      : current.laborUnionCnpj;
    const duplicate = await this.prisma.trackedCnpj.findFirst({
      where: {
        organizationId: current.organizationId,
        employerUnionCnpj: baseEmployerUnionCnpj,
        laborUnionCnpj: normalizedLaborUnionCnpj,
        NOT: {
          id,
        },
      },
    });

    if (duplicate) {
      throw new ConflictException('Esta dupla sindical ja esta cadastrada');
    }

    return this.prisma.trackedCnpj.update({
      where: { id },
      data: {
        ...dto,
        cnpj: baseEmployerUnionCnpj,
        name: baseEmployerUnionName,
        employerUnionName: baseEmployerUnionName,
        employerUnionCnpj: baseEmployerUnionCnpj,
        laborUnionCnpj: normalizedLaborUnionCnpj,
        baseMonth: dto.baseMonth,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.trackedCnpj.delete({ where: { id } });
  }
}
