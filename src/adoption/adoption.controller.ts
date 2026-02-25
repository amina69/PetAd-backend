import {
  Controller,
  Patch,
  Param,
  UseGuards,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AdoptionService } from './adoption.service';
import { CreateAdoptionDto } from './dto/create-adoption.dto';
import { Request } from 'express';

interface AuthRequest extends Request {
  user: {
    userId: string;
  };
}

@Controller('adoption')
export class AdoptionController {
  constructor(private readonly adoptionService: AdoptionService) {}

  @Post('requests')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async requestAdoption(
    @Req() req: AuthRequest,
    @Body() dto: CreateAdoptionDto,
  ) {
    return this.adoptionService.requestAdoption(req.user.userId, dto);
  }

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  approveAdoption(@Param('id') id: string) {
    return { message: `Adoption ${id} approved` };
  }
}
