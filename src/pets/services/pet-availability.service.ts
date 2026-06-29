import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdoptionStatus, CustodyStatus } from '@prisma/client';
import { PetStatus } from '../../common/enums';

@Injectable()
export class PetAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(petId: string): Promise<PetStatus> {
    const [latestAdoption, activeCustody] = await Promise.all([
      this.prisma.adoption.findFirst({
        where: { petId },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      }),
      this.prisma.custody.findFirst({
        where: { petId, status: CustodyStatus.ACTIVE },
        select: { status: true },
      }),
    ]);

    if (latestAdoption?.status === AdoptionStatus.COMPLETED) {
      return PetStatus.ADOPTED;
    }

    if (activeCustody) {
      return PetStatus.IN_CUSTODY;
    }

    const pendingStatuses: AdoptionStatus[] = [
      AdoptionStatus.REQUESTED,
      AdoptionStatus.PENDING,
      AdoptionStatus.APPROVED,
      AdoptionStatus.ESCROW_FUNDED,
    ];

    if (latestAdoption && pendingStatuses.includes(latestAdoption.status)) {
      return PetStatus.PENDING;
    }

    return PetStatus.AVAILABLE;
  }
}
