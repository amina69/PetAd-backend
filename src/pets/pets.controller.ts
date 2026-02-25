import { Controller, Post, Delete, UseGuards, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@Controller('pets')
export class PetsController {
  @Post('public-test')
  publicRoute() {
    return { message: 'Public route works' };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SHELTER, Role.ADMIN)
  createPet() {
    return { message: 'Pet created' };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  deletePet(@Param('id') id: string) {
    return { message: `Pet ${id} deleted` };
  }
}
