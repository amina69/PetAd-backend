import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../auth/enums/role.enum';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CreateFeeScheduleDto } from './dto/create-fee-schedule.dto';
import { FeeScheduleService } from './fee-schedule.service';

@ApiTags('admin:fees')
@ApiBearerAuth('JWT-auth')
@Controller('admin/fee-schedules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class FeeScheduleController {
  constructor(private readonly feeSchedules: FeeScheduleService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new immutable fee schedule version' })
  async create(
    @Body() dto: CreateFeeScheduleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const admin = user as unknown as { userId?: string; sub?: string } | undefined;
    return this.feeSchedules.create(dto, admin?.userId ?? admin?.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List all fee schedule versions (newest first)' })
  async findAll() {
    return this.feeSchedules.findAll();
  }

  @Get('effective')
  @ApiOperation({ summary: 'Get the schedule effective at an optional date' })
  async effective(@Query('at') at?: string) {
    const date = at ? new Date(at) : new Date();
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return this.feeSchedules.findEffective(date);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.feeSchedules.findById(id);
  }
}
