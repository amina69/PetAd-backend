import {
  Controller,
  Patch,
  Param,
  UseGuards,
  Req,
  Body,
} from '@nestjs/common';

import { AdoptionService } from './adoption.service';
import { RejectAdoptionDto } from './dto/reject-adoption.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@Controller('adoption')
export class AdoptionController {
  constructor(private readonly adoptionService: AdoptionService) {}

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async approve(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.adoptionService.approve(id, req.user.id);
  }

  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectAdoptionDto,
    @Req() req: any,
  ) {
    return this.adoptionService.reject(id, req.user.id, dto.reason);
  }
}
