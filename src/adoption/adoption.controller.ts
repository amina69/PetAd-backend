import {
  Controller,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AdoptionService } from './adoption.service';
import { CreateAdoptionDto } from './dto/create-adoption.dto';
import { UpdateAdoptionStatusDto } from './dto/update-adoption-status.dto';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

@Controller('adoption')
@UseGuards(JwtAuthGuard)
export class AdoptionController {
  constructor(private readonly adoptionService: AdoptionService) {}

  /**
   * POST /adoption
   * Any authenticated user can request to adopt a pet.
   * Fires ADOPTION_REQUESTED event on success.
   */
  @Post()
  requestAdoption(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateAdoptionDto,
  ) {
    return this.adoptionService.requestAdoption(req.user.userId, dto);
  }

  /**
   * PATCH /adoption/:id/approve
   * Admin-only. Approves a pending adoption request.
   * Fires ADOPTION_APPROVED event on success.
   */
  @Patch(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  approveAdoption(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.adoptionService.updateAdoptionStatus(id, req.user.userId, {
      status: 'APPROVED',
    });
  }

  /**
   * PATCH /adoption/:id/complete
   * Admin-only. Marks an adoption as completed.
   * Fires ADOPTION_COMPLETED event on success.
   */
  @Patch(':id/complete')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  completeAdoption(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.adoptionService.updateAdoptionStatus(id, req.user.userId, {
      status: 'COMPLETED',
    });
  }
}
