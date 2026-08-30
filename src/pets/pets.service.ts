import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { SearchPetsDto } from './dto/search-pets.dto';
import {
  PaginatedResponseDto,
  PaginationMetaDto,
} from '../common/dto/paginated-response.dto';
import { Prisma, AdoptionStatus, CustodyStatus } from '@prisma/client';
import { UserRole } from '../common/enums';
import { PetStatus } from '../common/enums/pet-status.enum';
import { PetAvailabilityService } from './services/pet-availability.service';
import { petAvailabilityReducer } from '../events/reducers/pet-availability.reducer';

@Injectable()
export class PetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: PetAvailabilityService,
  ) {}

  async getPetById(petId: string) {
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
      include: { currentOwner: true },
    });

    if (!pet) {
      throw new NotFoundException(`Pet with ID ${petId} not found`);
    }

    const computedStatus = await this.availabilityService.resolve(petId);

    return { ...pet, computedStatus, isAvailable: computedStatus === PetStatus.AVAILABLE };
  }

  async create(createPetDto: CreatePetDto, ownerId: string) {
    return this.prisma.pet.create({
      data: {
        ...createPetDto,
        currentOwnerId: ownerId,
      },
      include: { currentOwner: true },
    });
  }

  async findAll(searchDto: SearchPetsDto = {}) {
    const {
      page = 1,
      limit = 20,
      species,
      gender,
      size,
      breed,
      location,
      minAge,
      maxAge,
      search,
    } = searchDto;

    const where: Prisma.PetWhereInput = {
      ...(species && { species }),
      ...(gender && { gender }),
      ...(size && { size }),
      ...(breed && { breed: { contains: breed, mode: 'insensitive' } }),
      ...(location && {
        description: { contains: location, mode: 'insensitive' },
      }),
      ...(minAge !== undefined || maxAge !== undefined
        ? {
            age: {
              ...(minAge !== undefined && { gte: minAge }),
              ...(maxAge !== undefined && { lte: maxAge }),
            },
          }
        : {}),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { breed: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const skip = (page - 1) * limit;

    const [pets, total] = await Promise.all([
      this.prisma.pet.findMany({
        where,
        skip,
        take: limit,
        include: {
          currentOwner: true,
          adoptions: {
            where: {
              status: {
                notIn: [AdoptionStatus.REJECTED, AdoptionStatus.CANCELLED],
              },
            },
          },
          custodies: {
            where: {
              status: CustodyStatus.ACTIVE,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.pet.count({ where }),
    ]);

    // Resolve computed status for each pet
    const data = await Promise.all(
      pets.map(async (pet) => {
        const computedStatus = await this.availabilityService.resolve(pet.id);
        return {
          ...pet,
          computedStatus,
          isAvailable: computedStatus === PetStatus.AVAILABLE,
        };
      }),
    );

    const meta = new PaginationMetaDto(page, limit, total);

    return new PaginatedResponseDto(data, meta);
  }

  async findOne(id: string) {
    return this.getPetById(id);
  }

  async update(
    id: string,
    updatePetDto: UpdatePetDto,
    userId: string,
    userRole: string,
  ) {
    const pet = await this.prisma.pet.findUnique({ where: { id } });
    if (!pet) throw new NotFoundException('Pet not found');

    if (userRole !== UserRole.ADMIN) {
      if (pet.currentOwnerId !== userId) {
        throw new ForbiddenException('You can only update your own pets');
      }
    }

    return this.prisma.pet.update({
      where: { id },
      data: updatePetDto,
      include: { currentOwner: true },
    });
  }

  async remove(id: string, userRole: string) {
    const pet = await this.prisma.pet.findUnique({ where: { id } });
    if (!pet) throw new NotFoundException('Pet not found');

    if (userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Only administrators can delete pets');
    }

    await this.prisma.pet.delete({ where: { id } });
    return { message: 'Pet deleted successfully' };
  }

  /**
   * Verifies a pet's availability by replaying its event log and comparing
   * the replayed status against the current DB-computed availability.
   * Returns a discrepancy report if they differ.
   */
  async verifyAvailability(petId: string) {
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
    });

    if (!pet) {
      throw new NotFoundException(`Pet with ID ${petId} not found`);
    }

    // Get all events for this pet
    const events = await this.prisma.eventLog.findMany({
      where: {
        entityId: petId,
        entityType: 'PET',
      },
      orderBy: { createdAt: 'asc' },
      select: {
        eventType: true,
        createdAt: true,
      },
    });

    // Replay events to compute availability
    const replayedStatus = petAvailabilityReducer(events);

    // Get current DB-based availability
    const computedStatus = await this.availabilityService.resolve(petId);

    // Check if there's a discrepancy
    // AVAILABLE in replay -> pet should be available in DB
    // PENDING means "still available until approved" -> matches computedStatus=AVAILABLE
    // ADOPTED in replay means permanently not available -> matches computedStatus=ADOPTED
    // IN_CUSTODY means temporarily unavailable -> matches computedStatus=IN_CUSTODY
    const isMatch =
      (replayedStatus === PetStatus.AVAILABLE && computedStatus === PetStatus.AVAILABLE) ||
      (replayedStatus === PetStatus.PENDING && computedStatus === PetStatus.PENDING) ||
      (replayedStatus === PetStatus.ADOPTED && computedStatus === PetStatus.ADOPTED) ||
      (replayedStatus === PetStatus.IN_CUSTODY && computedStatus === PetStatus.IN_CUSTODY);

    return {
      petId,
      replayedStatus,
      computedStatus,
      isMatch,
      eventCount: events.length,
      ...(isMatch
        ? { message: 'Pet availability is correctly synchronized' }
        : {
            discrepancy: `Event replay indicates '${replayedStatus}' but DB computed state is '${computedStatus}'`,
          }),
    };
  }
}
