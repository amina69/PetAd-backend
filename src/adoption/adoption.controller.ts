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
  UseInterceptors,
  BadRequestException,
  UploadedFiles,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AdoptionService } from './adoption.service';
import { CreateAdoptionDto } from './dto/create-adoption.dto';
import { Request } from 'express';
import { DocumentsService } from '../documents/documents.service';
import { FilesInterceptor } from '@nestjs/platform-express';

interface AuthRequest extends Request {
  user: {
    sub: string;
  };
}

@Controller('adoption')
export class AdoptionController {
  constructor(
    private readonly adoptionService: AdoptionService,
    private readonly documentsService: DocumentsService,
  ) {}

  @Post('requests')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async requestAdoption(
    @Req() req: AuthRequest,
    @Body() dto: CreateAdoptionDto,
  ) {
    return this.adoptionService.requestAdoption(req.user.sub, dto);
  }

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async approveAdoption(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const actorId =
      (req as Request & { user?: { userId?: string } }).user?.userId;

    try {
      await this.eventsService.logEvent({
        entityType: EventEntityType.ADOPTION,
        entityId: id,
        eventType: EventType.ADOPTION_APPROVED,
        actorId,
        payload: {
          adoptionId: id,
          status: 'APPROVED',
          source: 'AdoptionController',
        },
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to record adoption approval event',
      );
    }

    return { message: `Adoption ${id} approved` };
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
    @Req() req: any,
  ) {
    return this.documentsService.uploadDocuments(
      adoptionId,
      req.user.userId,
      req.user.role,
      files,
    );
  }
}
