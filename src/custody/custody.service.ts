import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CreateCustodyDto } from './dto/create-custody.dto';

@Injectable()
export class CustodyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  async create(ownerId: string, dto: CreateCustodyDto) {
    const pet = await this.prisma.pet.findUnique({
      where: { id: dto.petId },
      select: { id: true, ownerId: true },
    });

    const startDate = new Date(dto.startDate);
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + dto.durationDays);

    const custody = await this.prisma.custody.create({
      data: {
        petId: dto.petId,
        ownerId: pet?.ownerId ?? ownerId,
        custodianId: ownerId,
        startDate,
        endDate,
        durationDays: dto.durationDays,
        depositAmount: dto.depositAmount,
      },
    });

    const payload = {
      petId: custody.petId,
      custodianId: custody.custodianId,
      ownerId: custody.ownerId,
      startDate: custody.startDate.toISOString(),
      endDate: custody.endDate.toISOString(),
      depositAmount:
        custody.depositAmount === null || custody.depositAmount === undefined
          ? null
          : String(custody.depositAmount),
    };

    await this.eventsService.appendEvent({
      aggregateType: 'CUSTODY',
      aggregateId: custody.id,
      eventType: 'CUSTODY_CREATED',
      actorId: ownerId,
      payload,
    });

    await this.eventsService.appendEvent({
      aggregateType: 'PET',
      aggregateId: custody.petId,
      eventType: 'PET_CUSTODY_STARTED',
      actorId: ownerId,
      payload,
    });

    return custody;
  }

  findAll() {
    return this.prisma.custody.findMany();
  }

  findOne(id: string) {
    return this.prisma.custody.findUnique({ where: { id } });
  }

  update(id: string, data: Record<string, unknown>) {
    return this.prisma.custody.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.custody.delete({ where: { id } });
  }
}
