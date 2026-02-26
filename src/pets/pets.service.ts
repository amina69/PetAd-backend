import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../common/enums';
import { ComputedPetStatus, PetAvailabilityService } from './pet-availability.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { SearchPetsDto } from './dto/search-pets.dto';
import {
  PaginatedResponseDto,
  PaginationMetaDto,
} from '../common/dto/paginated-response.dto';
import { Prisma } from '@prisma/client';

/**
 * Pet Service
 * Handles pet lifecycle management including status transitions
 */
@Injectable()
export class PetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: PetAvailabilityService,
  ) {}

  /**
   * Get pet by ID with computed availability
   * @param petId - The pet's ID
   * @throws NotFoundException if pet doesn't exist
   */
  async getPetById(petId: string) {
    return this.availabilityService.getPetWithAvailability(petId);
  }


  /**
   * Create a new pet
   * @param createPetDto - Data for creating the pet
   * @param ownerId - The ID of the owner (user) adopting the pet
   * @returns The created pet
   */
  async create(createPetDto: CreatePetDto, ownerId: string) {
    return this.prisma.pet.create({
      data: {
        ...createPetDto,
        currentOwnerId: ownerId,
      },
      include: { currentOwner: true },
    });
  }

  /**
   * Find all pets with pagination and filtering
   * @param searchDto - Search and pagination parameters
   * @returns Paginated response with pets and metadata
   */
  async findAll(searchDto: SearchPetsDto = {}) {
    const {
      page = 1,
      limit = 20,
      species,
      gender,
      size,
      status,
      search,
    } = searchDto;

    // Build filter conditions (filter by computed availability if status specified)
    const where: Prisma.PetWhereInput = {
      ...(species && { species }),
      ...(gender && { gender }),
      ...(size && { size }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { breed: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get pets with computed availability
    const pets = await this.availabilityService.getPetsWithAvailability({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    // Filter by computed status if specified
    const filteredPets = status
      ? pets.filter(pet => pet.status === status)
      : pets.filter(pet => pet.status === ComputedPetStatus.AVAILABLE); // Default to AVAILABLE for public

    // Get total count for pagination
    const total = status
      ? await this.countPetsByStatus(where, status)
      : await this.countPetsByStatus(where, ComputedPetStatus.AVAILABLE);

    // Build metadata
    const meta = new PaginationMetaDto(page, limit, total);

    // Return paginated response
    return new PaginatedResponseDto(filteredPets, meta);
  }

  /**
   * Find a pet by ID
   * @param id - The pet's ID
   * @returns The found pet
   * @throws NotFoundException if pet doesn't exist
   */
  async findOne(id: string) {
    return this.availabilityService.getPetWithAvailability(id);
  }

  /**
   * Update a pet
   * @param id - The pet's ID
   * @param updatePetDto - Data for updating the pet
   * @param userId - The ID of the user making the request
   * @param userRole - The role of the user (ADMIN, USER, SHELTER)
   * @returns The updated pet
   * @throws NotFoundException if pet doesn't exist
   * @throws ForbiddenException if user not authorized
   */
  async update(
    id: string,
    updatePetDto: UpdatePetDto,
    userId: string,
    userRole: string,
  ) {
    const pet = await this.prisma.pet.findUnique({ where: { id } });
    if (!pet) throw new NotFoundException('Pet not found');
    if (pet.currentOwnerId !== userId && userRole !== 'ADMIN')
      throw new ForbiddenException('Not authorized');
    
    const updatedPet = await this.prisma.pet.update({
      where: { id },
      data: updatePetDto,
      include: { currentOwner: true },
    });

    // Return with computed availability
    return this.availabilityService.getPetWithAvailability(id);
  }

  /**
   * Remove a pet
   * @param id - The pet's ID
   * @param userRole - The role of the user (ADMIN, USER, SHELTER)
   * @returns Success message
   * @throws NotFoundException if pet doesn't exist
   * @throws ForbiddenException if user not authorized
   */
  async remove(id: string, userRole: string) {
    const pet = await this.prisma.pet.findUnique({ where: { id } });
    if (!pet) throw new NotFoundException('Pet not found');
    if (userRole !== 'ADMIN')
      throw new ForbiddenException('Only admin can delete');
    await this.prisma.pet.delete({ where: { id } });
    return { message: 'Pet deleted successfully' };
  }

  /**
   * Count pets by computed status
   * @private
   */
  private async countPetsByStatus(
    where: Prisma.PetWhereInput,
    status: ComputedPetStatus,
  ): Promise<number> {
    const pets = await this.availabilityService.getPetsWithAvailability({ where });
    return pets.filter(pet => pet.status === status).length;
  }
}
