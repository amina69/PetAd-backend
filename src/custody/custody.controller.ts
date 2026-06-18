import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CustodyService } from './custody.service';
import type { CreateCustodyDto } from './dto/create-custody.dto';
import { CustodyResponseDto } from './dto/custody-response.dto';

@ApiTags('custody')
@Controller('custody')
export class CustodyController {
  constructor(private readonly custodyService: CustodyService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a custody agreement',
    description:
      'Request temporary custody of an available pet. Agreement starts in PENDING state.',
  })
  @ApiResponse({ status: 201, description: 'Custody agreement created (PENDING)', type: CustodyResponseDto })
  @ApiResponse({ status: 400, description: 'Bad Request - Pet unavailable or validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Pet not found' })
  async createCustody(
    @CurrentUser() user: CurrentUserPayload,
    @Body() createCustodyDto: CreateCustodyDto,
  ): Promise<CustodyResponseDto> {
    return this.custodyService.createCustody(user.userId, createCustodyDto);
  }

  @Post(':id/activate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SHELTER')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Activate a custody agreement',
    description:
      'Transitions custody from PENDING → ACTIVE. Only ADMIN or SHELTER roles may activate. ' +
      'Invalid transitions (e.g. re-activating a terminal state) are rejected.',
  })
  @ApiResponse({ status: 200, description: 'Custody activated', type: CustodyResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid state transition' })
  @ApiResponse({ status: 404, description: 'Custody not found' })
  async activateCustody(
    @Param('id') custodyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<CustodyResponseDto> {
    return this.custodyService.activateCustody(custodyId, user.userId);
  }

  @Post(':id/return')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Return custody agreement',
    description:
      'Transitions custody ACTIVE → RETURNED. Releases escrow and adds +5 trust score.',
  })
  @ApiResponse({ status: 200, description: 'Custody returned', type: CustodyResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid state transition' })
  @ApiResponse({ status: 404, description: 'Custody not found' })
  async returnCustody(@Param('id') custodyId: string): Promise<CustodyResponseDto> {
    return this.custodyService.returnCustody(custodyId);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel a custody agreement',
    description:
      'Transitions custody PENDING → CANCELLED or ACTIVE → CANCELLED. ' +
      'Refunds escrow if present. Terminal states cannot be cancelled.',
  })
  @ApiResponse({ status: 200, description: 'Custody cancelled', type: CustodyResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid state transition' })
  @ApiResponse({ status: 404, description: 'Custody not found' })
  async cancelCustody(
    @Param('id') custodyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<CustodyResponseDto> {
    return this.custodyService.cancelCustody(custodyId, user.userId);
  }

  @Post(':id/violation')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark custody as violation',
    description:
      'Transitions custody ACTIVE → VIOLATION. Refunds escrow and applies −15 trust score.',
  })
  @ApiResponse({ status: 200, description: 'Custody marked as violation', type: CustodyResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid state transition' })
  @ApiResponse({ status: 404, description: 'Custody not found' })
  async violationCustody(@Param('id') custodyId: string): Promise<CustodyResponseDto> {
    return this.custodyService.violationCustody(custodyId);
  }
}
