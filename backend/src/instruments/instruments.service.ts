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

    const where: any = {};
    if (isNew !== undefined) {
      where.isNew = isNew;
    }
    if (uf) {
      where.uf = uf;
    }
    if (cnpj) {
      where.parties = {
        some: {
          cnpj,
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
}
