import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
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
      'Request temporary custody of an available pet for a specified time period with optional deposit',
  })
  @ApiResponse({
    status: 201,
    description: 'Custody agreement successfully created',
    type: CustodyResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request - Pet unavailable, invalid dates, or validation errors',
    schema: {
      example: {
        statusCode: 400,
        message: 'Pet already has an active custody agreement',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Missing or invalid JWT token',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Pet does not exist',
    schema: {
      example: {
        statusCode: 404,
        message: 'Pet with id {petId} not found',
        error: 'Not Found',
      },
    },
  })
  async createCustody(
    @CurrentUser() user: CurrentUserPayload,
    @Body() createCustodyDto: CreateCustodyDto,
  ): Promise<CustodyResponseDto> {
    return this.custodyService.createCustody(user.userId, createCustodyDto);
  }

  @Patch(':id/return')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Return custody of a pet',
    description:
      'Mark custody as RETURNED, release escrow deposit, update trust score, and make pet available again',
  })
  @ApiParam({
    name: 'id',
    description: 'Custody ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Custody successfully returned',
    type: CustodyResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Custody not ACTIVE or user not holder',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Custody does not exist',
  })
  async returnCustody(
    @Param('id') custodyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<CustodyResponseDto> {
    return this.custodyService.returnCustody(custodyId, user.userId);
  }

  @Patch(':id/violation')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark custody as violation (Admin only)',
    description:
      'Mark custody as VIOLATION, refund escrow to owner, penalize trust score, and make pet available again',
  })
  @ApiParam({
    name: 'id',
    description: 'Custody ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          example: 'Pet was not properly cared for',
          description: 'Reason for marking as violation',
        },
      },
    },
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Custody marked as violation',
    type: CustodyResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Custody not ACTIVE',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Custody does not exist',
  })
  async violationCustody(
    @Param('id') custodyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() body?: { reason?: string },
  ): Promise<CustodyResponseDto> {
    return this.custodyService.violationCustody(
      custodyId,
      user.userId,
      body?.reason,
    );
  }
}
