import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AdoptionService } from './adoption.service';
import { FilterAdoptionsDto } from './dto/filter-adoptions.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    email: string;
    role: string;
  };
}

@ApiTags('Adoptions')
@Controller()
export class AdoptionController {
  constructor(private readonly adoptionService: AdoptionService) {}

  @Get('adoptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'List adoption requests based on the authenticated user role',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by adoption status',
  })
  @ApiQuery({
    name: 'petId',
    required: false,
    description: 'Filter by pet id',
  })
  @ApiResponse({ status: 200, description: 'Adoption requests retrieved' })
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Query() filters: FilterAdoptionsDto,
  ) {
    const data = await this.adoptionService.findAll(req.user, filters);
    return { data };
  }

  @Patch('adoption/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  approveAdoption(@Param('id') id: string) {
    return { message: `Adoption ${id} approved` };
  }
}
