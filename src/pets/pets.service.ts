import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PetsRepository } from './pets.repository';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { SearchPetsDto } from './dto/search-pets.dto';
import {
  PaginatedResponseDto,
  PaginationMetaDto,
} from '../common/dto/paginated-response.dto';
import {
  Prisma,
  AdoptionStatus,
  CustodyStatus,
  UserStatus,
} from '@prisma/client';
import { UserRole } from '../common/enums';
import { PetStatus } from '../common/enums/pet-status.enum';
import { PetAvailabilityService } from './services/pet-availability.service';
import { petAvailabilityReducer } from '../events/reducers/pet-availability.reducer';

export interface PetsViewer {
  role?: string;
}

@Injectable()
export class PetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly petsRepository: PetsRepository,
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

    return {
      ...pet,
      computedStatus,
      isAvailable: computedStatus === PetStatus.AVAILABLE,
    };
  }

  async create(createPetDto: CreatePetDto, ownerId: string) {
    return this.prisma.pet.create({
      data: {
        ...createPetDto,
        ...(createPetDto.latitude !== undefined && {
          latitude: roundCoordinate(createPetDto.latitude),
        }),
        ...(createPetDto.longitude !== undefined && {
          longitude: roundCoordinate(createPetDto.longitude),
        }),
        currentOwnerId: ownerId,
      },
      include: { currentOwner: true },
    });
  }

  async findAll(searchDto: SearchPetsDto = {}, viewer: PetsViewer = {}) {
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
      near,
      radius,
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

    // Listings owned by suspended accounts are hidden from the public search.
    // Admins keep the full picture so they can moderate.
    if (viewer.role !== UserRole.ADMIN) {
      where.AND = [
        {
          OR: [
            { currentOwnerId: null },
            { currentOwner: { status: UserStatus.ACTIVE } },
          ],
        },
      ];
    }

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

  /**
   * Radius search (`near=lat,lng&radius=km`).
   *
   * Candidate ids within the radius come from the Haversine query in
   * PetsRepository (ordered nearest-first); the remaining text/enum filters
   * are applied through Prisma on top of that candidate set. `distanceKm` is
   * attached to every item and is only ever present on this code path —
   * plain listings never expose it.
   */
  private async findAllNearby({
    where,
    near,
    radius,
    page,
    limit,
  }: {
    where: Prisma.PetWhereInput;
    near: string;
    radius?: number;
    page: number;
    limit: number;
  }) {
    const { latitude, longitude } = this.parseNear(near);
    // Radius is capped so a client cannot request an unbounded scan.
    const radiusKm = Math.min(radius ?? DEFAULT_RADIUS_KM, MAX_RADIUS_KM);

    const candidates = await this.petsRepository.findIdsWithinRadius(
      latitude,
      longitude,
      radiusKm,
    );

    if (candidates.length === 0) {
      return new PaginatedResponseDto(
        [],
        new PaginationMetaDto(page, limit, 0),
      );
    }

    const distanceById = new Map(candidates.map((c) => [c.id, c.distanceKm]));

    const geoWhere: Prisma.PetWhereInput = {
      AND: [where, { id: { in: candidates.map((c) => c.id) } }],
    };

    // Apply the non-geo filters to the candidate set while preserving the
    // repository's nearest-first ordering, then paginate over that result so
    // pages are never short due to a filtered-out neighbour.
    const matchingRows = await this.prisma.pet.findMany({
      where: geoWhere,
      select: { id: true },
    });
    const matchingIds = new Set(matchingRows.map((pet) => pet.id));
    const orderedIds = candidates
      .map((c) => c.id)
      .filter((id) => matchingIds.has(id));

    const total = orderedIds.length;
    const skip = (page - 1) * limit;
    const pageIds = orderedIds.slice(skip, skip + limit);

    const pets =
      pageIds.length > 0
        ? await this.prisma.pet.findMany({
            where: { id: { in: pageIds } },
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
          })
        : [];

    // Re-order the page to match the nearest-first candidate ordering.
    const petsById = new Map(pets.map((pet) => [pet.id, pet]));
    const orderedPets = pageIds
      .map((id) => petsById.get(id))
      .filter((pet): pet is NonNullable<typeof pet> => pet !== undefined);

    const data = await Promise.all(
      orderedPets.map(async (pet) => {
        const computedStatus = await this.availabilityService.resolve(pet.id);
        return {
          ...pet,
          computedStatus,
          isAvailable: computedStatus === PetStatus.AVAILABLE,
          distanceKm: distanceById.get(pet.id),
        };
      }),
    );

    const meta = new PaginationMetaDto(page, limit, total);

    return new PaginatedResponseDto(data, meta);
  }

  /**
   * Parses a `near=lat,lng` query value into validated coordinates.
   */
  private parseNear(near: string): { latitude: number; longitude: number } {
    const [latPart, lngPart] = near.split(',').map((part) => part.trim());
    const latitude = Number(latPart);
    const longitude = Number(lngPart);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new BadRequestException(
        'near latitude must be a number between -90 and 90',
      );
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new BadRequestException(
        'near longitude must be a number between -180 and 180',
      );
    }

    return { latitude, longitude };
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

    if (userRole !== UserRole.ADMIN.toString()) {
      if (pet.currentOwnerId !== userId) {
        throw new ForbiddenException('You can only update your own pets');
      }
    }

    return this.prisma.pet.update({
      where: { id },
      data: {
        ...updatePetDto,
        ...(updatePetDto.latitude !== undefined && {
          latitude: roundCoordinate(updatePetDto.latitude),
        }),
        ...(updatePetDto.longitude !== undefined && {
          longitude: roundCoordinate(updatePetDto.longitude),
        }),
      },
      include: { currentOwner: true },
    });
  }

  async remove(id: string, userRole: string) {
    const pet = await this.prisma.pet.findUnique({ where: { id } });
    if (!pet) throw new NotFoundException('Pet not found');

    if (userRole !== UserRole.ADMIN.toString()) {
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
      (replayedStatus === PetStatus.AVAILABLE &&
        computedStatus === PetStatus.AVAILABLE) ||
      (replayedStatus === PetStatus.PENDING &&
        computedStatus === PetStatus.PENDING) ||
      (replayedStatus === PetStatus.ADOPTED &&
        computedStatus === PetStatus.ADOPTED) ||
      (replayedStatus === PetStatus.IN_CUSTODY &&
        computedStatus === PetStatus.IN_CUSTODY);

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
