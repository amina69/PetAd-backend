import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdoptionStatus, CustodyStatus } from '@prisma/client';

@Injectable()
export class PetAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getPetAvailability(petId: string): Promise<boolean> {
    const blockingAdoption = await this.prisma.adoption.findFirst({
      where: {
        petId,
        status: {
          notIn: [AdoptionStatus.REJECTED, AdoptionStatus.CANCELLED],
        },
      },
      select: { id: true },
    });

    if (blockingAdoption) return false;

    const activeCustody = await this.prisma.custody.findFirst({
      where: {
        petId,
        status: CustodyStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (activeCustody) return false;

    return true;
  }
}
