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

  @Post(':id/return')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Return custody agreement',
    description:
      'End custody agreement successfully. Releases escrow and updates trust score positively',
  })
  @ApiResponse({
    status: 200,
    description: 'Custody successfully returned',
    type: CustodyResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Custody not active',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Custody does not exist',
  })
  async returnCustody(@Param('id') custodyId: string): Promise<CustodyResponseDto> {
    return this.custodyService.returnCustody(custodyId);
  }

  @Post(':id/violation')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark custody as violation',
    description:
      'Report custody violation. Refunds escrow and penalizes trust score',
  })
  @ApiResponse({
    status: 200,
    description: 'Custody marked as violation',
    type: CustodyResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Custody not active',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Custody does not exist',
  })
  async violationCustody(@Param('id') custodyId: string): Promise<CustodyResponseDto> {
    return this.custodyService.violationCustody(custodyId);
  }
}
