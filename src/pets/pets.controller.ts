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
  Res,
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
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { PetsService } from './pets.service';
import { PetMovementService } from './services/pet-movement.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { SearchPetsDto } from './dto/search-pets.dto';
import { UserRole } from '../common/enums';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@ApiTags('Pets')
@Controller('pets')
export class PetsController {
  constructor(
    private readonly petsService: PetsService,
    private readonly petMovementService: PetMovementService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SHELTER', 'ADMIN')
  @ApiOperation({ summary: 'Create new pet listing' })
  @ApiBody({ type: CreatePetDto })
  @ApiResponse({ status: 201, description: 'Pet created successfully' })
  @ApiBearerAuth('JWT-auth')
  async create(
    @Body() createPetDto: CreatePetDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.petsService.create(createPetDto, req.user.sub);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'List pets with pagination and filtering',
    description:
      'Returns paginated list of pets with optional filtering and computed availability. ' +
      'Listings owned by suspended accounts are omitted for anonymous and non-admin callers.',
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
            isAvailable: true,
            currentOwnerId: '550e8400-e29b-41d4-a716-446655440001',
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
  async findAll(
    @Query() searchDto: SearchPetsDto,
    @Request() req: { user?: { userId?: string; role?: string } },
  ) {
    return this.petsService.findAll(searchDto, req.user ?? {});
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get pet details',
    description:
      'Retrieve detailed information about a specific pet including computed availability',
  })
  @ApiParam({
    name: 'id',
    description: 'Pet ID',
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
        isAvailable: true,
        currentOwnerId: '550e8400-e29b-41d4-a716-446655440001',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Pet not found' })
  async getPet(@Param('id') petId: string) {
    return this.petsService.getPetById(petId);
  }

  @Get(':id/history')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Get pet movement timeline and chain of custody',
    description:
      'Returns ordered movement chain, custody hops, and anomaly detection. Supports ?format=json|csv. Public view is limited to counts and verified-chain badge.',
  })
  @ApiParam({
    name: 'id',
    description: 'Pet ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Pet movement history and custody chain',
    schema: {
      example: {
        petId: '550e8400-e29b-41d4-a716-446655440000',
        petName: 'Buddy',
        verifiedChain: true,
        anomalyCount: 0,
        anomalies: [],
        custodyChain: [],
        timeline: [],
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Pet not found' })
  async getMovementHistory(
    @Param('id') petId: string,
    @Query('format') format: 'json' | 'csv' = 'json',
    @Request() req: { user?: { userId?: string; role?: string } },
    @Res({ passthrough: true }) res?: any,
  ) {
    const result = await this.petMovementService.getMovementHistory(
      petId,
      format,
      req.user,
    );
    if (format === 'csv' && res) {
      res.setHeader('Content-Type', 'text/csv');
    }
    return result;
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SHELTER', 'ADMIN')
  @ApiOperation({
    summary: 'Update pet information',
  })
  @ApiParam({ name: 'id', description: 'Pet ID' })
  @ApiBody({ type: UpdatePetDto })
  @ApiResponse({ status: 200, description: 'Pet updated successfully' })
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

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Remove pet listing (admin only)',
  })
  @ApiParam({ name: 'id', description: 'Pet ID' })
  @ApiResponse({
    status: 200,
    description: 'Pet deleted successfully',
    schema: {
      example: {
        message: 'Pet deleted successfully',
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'Pet not found' })
  @ApiBearerAuth('JWT-auth')
  async remove(
    @Param('id') id: string,
    @Request() req: { user: { role: UserRole } },
  ) {
    return this.petsService.remove(id, req.user.role);
  }

  @Get(':id/availability/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Verify pet availability via event replay (admin only)',
    description:
      "Replays the pet's event log to compute availability and compares it against the current DB state. " +
      'Returns a discrepancy report if the two differ.',
  })
  @ApiParam({ name: 'id', description: 'Pet ID' })
  @ApiResponse({
    status: 200,
    description: 'Availability verification result',
    schema: {
      example: {
        petId: '550e8400-e29b-41d4-a716-446655440000',
        storedStatus: 'AVAILABLE',
        replayedStatus: 'AVAILABLE',
        computedStatus: 'AVAILABLE',
        isMatch: true,
        eventCount: 3,
        message: 'Pet availability is correctly synchronized',
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'Pet not found' })
  @ApiBearerAuth('JWT-auth')
  async verifyAvailability(@Param('id') petId: string) {
    return this.petsService.verifyAvailability(petId);
  }
}
