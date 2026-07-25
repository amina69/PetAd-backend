import {
  Controller,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  BadRequestException,
  UploadedFiles,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AdoptionService } from './adoption.service';
import { CreateAdoptionDto } from './dto/create-adoption.dto';
import { DocumentsService } from '../documents/documents.service';
import { FilesInterceptor } from '@nestjs/platform-express';
import { EventsService } from '../events/events.service';
import { EventEntityType, EventType } from '@prisma/client';
import { Get, Query } from '@nestjs/common';
import { ApiQuery, ApiResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FilterAdoptionsDto } from './dto/filter-adoptions.dto';
import { CurrentUser as GetUser } from '../auth/decorators/current-user.decorator';
import { RejectAdoptionDto } from './dto/reject-adoption.dto';


interface AuthRequest extends Request {
  user: { userId: string; email: string; role: string; sub?: string };
}

@Controller('adoption')
@UseGuards(JwtAuthGuard)
export class AdoptionController {
  constructor(
    private readonly adoptionService: AdoptionService,
    private readonly documentsService: DocumentsService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * POST /adoption/requests
   * Any authenticated user can request to adopt a pet.
   * Fires ADOPTION_REQUESTED event on success.
   */
  @Post('requests')
  @HttpCode(HttpStatus.CREATED)
  requestAdoption(@Req() req: AuthRequest, @Body() dto: CreateAdoptionDto) {
    return this.adoptionService.requestAdoption(
      (req.user.userId || req.user.sub) as string,
      dto,
    );
  }

  /**
   * PATCH /adoption/:id/approve
   * Admin-only. Approves a pending adoption request.
   * Fires ADOPTION_APPROVED event on success.
   */
  @Patch(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Approve a pending adoption request (Admin only)' })
  @ApiResponse({ status: 200, description: 'Adoption approved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Adoption not found' })
  @ApiResponse({ status: 422, description: 'Invalid status transition' })
  approveAdoption(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.adoptionService.approveAdoption(
      id,
      (req.user.userId || req.user.sub) as string,
    );
  }

  /**
   * PATCH /adoption/:id/reject
   * Admin-only. Rejects a pending adoption request.
   * Updates adoption status to REJECTED and pet becomes available again.
   */
  @Patch(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reject a pending adoption request (Admin only)' })
  @ApiResponse({ status: 200, description: 'Adoption rejected successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Adoption not found' })
  @ApiResponse({ status: 422, description: 'Invalid status transition' })
  rejectAdoption(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: RejectAdoptionDto,
  ) {
    return this.adoptionService.rejectAdoption(
      id,
      (req.user.userId || req.user.sub) as string,
      dto,
    );
  }

  /**
   * PATCH /adoption/:id/complete
   * Admin-only. Marks an adoption as completed.
   * Fires ADOPTION_COMPLETED event on success.
   */
  @Patch(':id/complete')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  completeAdoption(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.adoptionService.updateAdoptionStatus(id, req.user.userId, {
      status: 'COMPLETED',
    });
  }

  @Post(':id/documents')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE ?? '10485760'),
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];

        if (!allowedTypes.includes(file.mimetype)) {
          cb(
            new BadRequestException('Only PDF and DOCX files are allowed'),
            false,
          );
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async uploadDocuments(
    @Param('id') adoptionId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: AuthRequest,
  ) {
    return this.documentsService.uploadDocuments(
      adoptionId,
      (req.user.userId || req.user.sub) as string,
      req.user.role as Role,
      files,
    );
  }

  /**
   * GET /adoption
   * Retrieves all adoptions matching the query parameters and the user's role constraints.
   */
  @Get()
  @ApiOperation({ summary: 'Get all adoptions for the current user based on role' })
  @ApiQuery({ name: 'status', required: false, enum: ['REQUESTED', 'PENDING', 'APPROVED', 'ESCROW_FUNDED', 'COMPLETED', 'REJECTED', 'CANCELLED'] })
  @ApiQuery({ name: 'petId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'List of adoptions' })
  async findAll(
    @GetUser() user: any,
    @Query() query: FilterAdoptionsDto,
  ) {
    // If the CurrentUser decorator isn't wired properly, fallback to req.user would be needed,
    // but assuming @GetUser() returns the JwtPayload directly.
    return this.adoptionService.findAll(user, query);
  }
}
