import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InstrumentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: {
    skip?: number;
    take?: number;
    cnpj?: string;
    isNew?: boolean;
    uf?: string;
  }) {
    const { skip, take, cnpj, isNew, uf } = params;
    const normalizedCnpj = cnpj?.replace(/\D/g, '');

    const where: any = {};
    if (isNew !== undefined) {
      where.isNew = isNew;
    }
    if (uf) {
      where.uf = uf;
    }
    if (normalizedCnpj) {
      where.parties = {
        some: {
          cnpj: {
            contains: normalizedCnpj,
          },
        },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.instrument.findMany({
        where,
        skip,
        take: take || 20,
        orderBy: { registerDate: 'desc' },
        include: { parties: true },
      }),
      this.prisma.instrument.count({ where }),
    ]);

    return { data: items, total };
  }

  async findOne(id: string) {
    const instrument = await this.prisma.instrument.findUnique({
      where: { id },
      include: { parties: true },
    });
    if (!instrument) throw new NotFoundException('Instrument not found');

    return instrument;
  }

  async markAsRead(id: string) {
    const instrument = await this.prisma.instrument.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!instrument) {
      throw new NotFoundException('Instrument not found');
    }

    return this.prisma.instrument.update({
      where: { id },
      data: { isNew: false },
      include: { parties: true },
    });
  }

  async remove(id: string) {
    const instrument = await this.prisma.instrument.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!instrument) {
      throw new NotFoundException('Instrument not found');
    }

    await this.prisma.$transaction([
      this.prisma.instrumentParty.deleteMany({
        where: { instrumentId: id },
      }),
      this.prisma.instrument.delete({
        where: { id },
      }),
    ]);

    return { success: true };
  }
}
