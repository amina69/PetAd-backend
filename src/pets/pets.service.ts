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
import { PetAvailabilityService } from './services/pet-availability.service';

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

    const isAvailable =
      await this.availabilityService.getPetAvailability(petId);

    return { ...pet, isAvailable };
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

    const data = pets.map((pet) => ({
      ...pet,
      isAvailable: pet.adoptions.length === 0 && pet.custodies.length === 0,
    }));

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
}
