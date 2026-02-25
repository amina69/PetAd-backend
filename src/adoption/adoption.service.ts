import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FilterAdoptionsDto } from './dto/filter-adoptions.dto';
import { Role } from '../auth/enums/role.enum';

interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
}

@Injectable()
export class AdoptionService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser, filters: FilterAdoptionsDto) {
    const where: Prisma.AdoptionWhereInput = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.petId) {
      where.petId = filters.petId;
    }

    if (user.role === Role.USER) {
      where.adopterId = user.userId;
    } else if (user.role === Role.SHELTER) {
      where.pet = { currentOwnerId: user.userId };
    } else if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Unsupported role');
    }

    const adoptions = await this.prisma.adoption.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        notes: true,
        createdAt: true,
        pet: {
          select: {
            id: true,
            name: true,
            species: true,
            imageUrl: true,
          },
        },
        adopter: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return adoptions.map((adoption) => ({
      id: adoption.id,
      status: adoption.status,
      reason: adoption.notes,
      createdAt: adoption.createdAt,
      pet: {
        id: adoption.pet.id,
        name: adoption.pet.name,
        species: adoption.pet.species,
        imageUrl: adoption.pet.imageUrl,
        images: adoption.pet.imageUrl ? [adoption.pet.imageUrl] : [],
      },
      user: {
        id: adoption.adopter.id,
        name: `${adoption.adopter.firstName} ${adoption.adopter.lastName}`.trim(),
        email: adoption.adopter.email,
      },
    }));
  }
}
