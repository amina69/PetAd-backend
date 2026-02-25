import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdoptionStatus } from '@prisma/client';

@Injectable()
export class AdoptionService {
  constructor(private prisma: PrismaService) {}

  async approve(adoptionId: string, adminUserId: string) {
    const adoption = await this.prisma.adoption.findUnique({
      where: { id: adoptionId },
      include: { pet: true, adopter: true, owner: true },
    });

    if (!adoption) {
      throw new NotFoundException('Adoption not found');
    }

    if (adoption.status !== AdoptionStatus.PENDING) {
      throw new BadRequestException('Adoption is not pending');
    }

    return this.prisma.adoption.update({
      where: { id: adoptionId },
      data: {
        status: AdoptionStatus.APPROVED,
      },
      include: { pet: true, adopter: true, owner: true },
    });
  }

  async reject(
    adoptionId: string,
    adminUserId: string,
    reason?: string,
  ) {
    const adoption = await this.prisma.adoption.findUnique({
      where: { id: adoptionId },
      include: { pet: true },
    });

    if (!adoption) {
      throw new NotFoundException('Adoption not found');
    }

    if (adoption.status !== AdoptionStatus.PENDING) {
      throw new BadRequestException('Adoption is not pending');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedAdoption = await tx.adoption.update({
        where: { id: adoptionId },
        data: {
          status: AdoptionStatus.REJECTED,
          notes: reason ?? null,
        },
        include: { pet: true, adopter: true, owner: true },
      });

      return updatedAdoption;
    });
  }
}
