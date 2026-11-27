import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../auth/enums/role.enum';
import { ProjectionRunnerService } from './projection-runner.service';
import { Projection } from './projection.interface';

@ApiTags('Projections')
@Controller('admin/projections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class ProjectionAdminController {
  constructor(
    private readonly runnerService: ProjectionRunnerService,
    private readonly registeredProjections: Projection[],
  ) {}

  @Post(':name/rebuild')
  @ApiOperation({ summary: 'Rebuild a specific projection by name' })
  @ApiResponse({ status: 200, description: 'Projection rebuilt successfully' })
  @ApiResponse({ status: 404, description: 'Projection not found' })
  async rebuild(@Param('name') name: string) {
    const projection = this.registeredProjections.find((p) => p.name === name);
    if (!projection) {
      throw new Error(`Projection ${name} not found`);
    }
    await this.runnerService.rebuildProjection(projection);
    return { message: `Projection ${name} rebuilt successfully` };
  }
}
