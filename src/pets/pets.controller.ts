import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { PetsService } from './pets.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { SearchPetsDto } from './dto/search-pets.dto';
import { UserRole } from '../common/enums';

/**
 * Pets Controller
 * Handles all pet-related HTTP requests including status lifecycle
 */
@ApiTags('Pets')
@Controller('pets')
export class PetsController {
  constructor(private readonly petsService: PetsService) {}

  /**
   * Create new pet listing
   * Requires JWT authentication
   * Shelter or Admin role required
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SHELTER', 'ADMIN')
  @ApiOperation({ summary: 'Create new pet listing' })
  @ApiBody({ type: CreatePetDto })
  @ApiResponse({ status: 201, description: 'Pet created' })
  @ApiBearerAuth('JWT-auth')
  async create(
    @Body() createPetDto: CreatePetDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.petsService.create(createPetDto, req.user.sub);
  }

  /**
   * List all available pets with pagination
   * Public endpoint - no authentication required
   */
  @Get()
  @ApiOperation({
    summary: 'List all available pets with pagination',
    description:
      'Returns paginated list of pets with optional filtering by species, gender, size, status, and search query',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated pets list',
    schema: {
      example: {
        data: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            name: 'Buddy',
            species: 'DOG',
            breed: 'Golden Retriever',
            age: 3,
            gender: 'MALE',
            size: 'LARGE',
            description: 'Friendly and energetic dog',
            imageUrl: 'https://example.com/buddy.jpg',
            status: 'AVAILABLE',
            currentOwnerId: '550e8400-e29b-41d4-a716-446655440001',
            createdAt: '2026-02-25T10:00:00Z',
            updatedAt: '2026-02-25T10:00:00Z',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440002',
            name: 'Max',
            species: 'DOG',
            breed: 'Labrador',
            age: 2,
            gender: 'MALE',
            size: 'LARGE',
            description: 'Playful and loyal',
            imageUrl: 'https://example.com/max.jpg',
            status: 'AVAILABLE',
            currentOwnerId: '550e8400-e29b-41d4-a716-446655440001',
            createdAt: '2026-02-24T10:00:00Z',
            updatedAt: '2026-02-24T10:00:00Z',
          },
        ],
        meta: {
          page: 1,
          limit: 20,
          total: 150,
          totalPages: 8,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      },
    },
  })
  async findAll(@Query() searchDto: SearchPetsDto) {
    return this.petsService.findAll(searchDto);
  }

  /**
   * Get pet details by ID
   * Public endpoint - no authentication required
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get pet details',
    description: 'Retrieve detailed information about a specific pet',
  })
  @ApiParam({
    name: 'id',
    description: 'Pet ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Pet found',
    schema: {
      example: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Buddy',
        species: 'DOG',
        breed: 'Golden Retriever',
        age: 3,
        description: 'Friendly and energetic dog',
        imageUrl: 'https://example.com/buddy.jpg',
        status: 'AVAILABLE',
        currentOwnerId: '550e8400-e29b-41d4-a716-446655440001',
        createdAt: '2026-02-25T10:00:00Z',
        updatedAt: '2026-02-25T10:00:00Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Pet not found' })
  async getPet(@Param('id') petId: string) {
    return this.petsService.getPetById(petId);
  }

  /**
   * Update pet information
   * Requires JWT authentication
   * Shelter or Admin role required
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SHELTER', 'ADMIN')
  @ApiOperation({ summary: 'Update pet information' })
  @ApiParam({ name: 'id', description: 'Pet ID' })
  @ApiBody({ type: UpdatePetDto })
  @ApiResponse({ status: 200, description: 'Pet updated' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Pet not found' })
  @ApiBearerAuth('JWT-auth')
  async update(
    @Param('id') id: string,
    @Body() updatePetDto: UpdatePetDto,
    @Request() req: { user: { sub: string; role: string } },
  ) {
    return this.petsService.update(
      id,
      updatePetDto,
      req.user.sub,
      req.user.role,
    );
  }

  /**
   * Update pet status with state machine validation
   /**
   * Remove pet listing
   * Requires JWT authentication
   * Admin role required
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Remove pet listing' })
  @ApiParam({ name: 'id', description: 'Pet ID' })
  @ApiResponse({ status: 200, description: 'Pet deleted' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Pet not found' })
  @ApiBearerAuth('JWT-auth')
  async remove(
    @Param('id') id: string,
    @Request() req: { user: { role: UserRole } },
  ) {
    return this.petsService.remove(id, req.user.role);
  }
}
