import {
  Controller,
  Get,
  Patch,
  Delete,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { PublicProfileDto } from './dto/public-profile.dto';
import { DataExportService } from './data-export/data-export.service';
import {
  DataExportInitiatedDto,
  DataExportStatusResponseDto,
} from './data-export/dto/data-export-response.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { ListUsersDto } from './dto/list-users.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  assertSupportedAvatar,
  MAX_AVATAR_SIZE_BYTES,
} from './utils/image-signature';

interface DownloadRequest extends Request {
  user?: {
    userId?: string;
    sub?: string;
    role?: string;
  };
}

interface AuthRequest extends Request {
  user: {
    userId?: string;
    sub?: string;
    role?: string;
  };
}

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly cloudinary: CloudinaryService,
    private readonly dataExportService: DataExportService,
  ) {}

  /**
   * JwtStrategy.validate() exposes the subject as `sub`; some legacy callers
   * read `userId`. Accept either so ownership checks actually run.
   */
  private getRequester(req: AuthRequest): { id: string; role?: string } {
    const id = req.user?.userId ?? req.user?.sub;
    if (!id) {
      throw new UnauthorizedException();
    }
    return { id, role: req.user.role };
  }

  private checkOwnership(req: AuthRequest, id: string) {
    const requester = this.getRequester(req);
    if (requester.id !== id && requester.role !== 'ADMIN') {
      throw new UnauthorizedException();
    }
    return requester;
  }

  private actorId(req: AuthRequest): string | undefined {
    return req.user.userId ?? req.user.sub;
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List users (Admin only)' })
  async listUsers(@Query() query: ListUsersDto) {
    return this.usersService.listUsers(query);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('me/data-export')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request personal data export (async)' })
  @ApiResponse({
    status: 202,
    description: 'Export request accepted and enqueued',
    type: DataExportInitiatedDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Active export request already in progress',
  })
  async requestDataExport(
    @Req() req: AuthRequest,
  ): Promise<DataExportInitiatedDto> {
    const userId = req.user.userId || req.user.sub;
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.dataExportService.requestDataExport(userId);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Get('me/data-export/:id')
  @ApiOperation({
    summary: 'Get personal data export status and signed download URL',
  })
  @ApiResponse({
    status: 200,
    description: 'Export status retrieved',
    type: DataExportStatusResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Export request not found' })
  async getDataExportStatus(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ): Promise<DataExportStatusResponseDto> {
    const userId = req.user.userId || req.user.sub;
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.dataExportService.getDataExportStatus(id, userId);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Get('me/data-export/:id/download')
  @ApiOperation({
    summary:
      'Download personal data export ZIP archive via short-lived signed link',
  })
  @ApiResponse({ status: 200, description: 'ZIP archive download stream' })
  @ApiResponse({ status: 410, description: 'Link expired or file purged' })
  @ApiResponse({ status: 404, description: 'Export file not found' })
  async downloadDataExport(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Req() req: DownloadRequest,
    @Res() res: Response,
  ) {
    const authUserId = req.user?.userId || req.user?.sub;
    const { stream, fileSize, fileName } =
      await this.dataExportService.getExportFileForDownload(
        id,
        expires,
        sig,
        authUserId,
      );

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': fileSize.toString(),
    });

    stream.pipe(res);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Get(':id/public')
  @ApiOperation({ summary: 'Get public user profile' })
  @ApiResponse({
    status: 200,
    description: 'Public profile retrieved',
    type: PublicProfileDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found or suspended/deleted',
  })
  async getPublicProfile(@Param('id') id: string): Promise<PublicProfileDto> {
    return this.usersService.getPublicProfile(id);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Get(':id')
  @ApiOperation({ summary: 'Get user profile' })
  async getProfile(@Param('id') id: string, @Req() req: AuthRequest) {
    this.checkOwnership(req, id);
    return this.usersService.getProfile(id);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Patch(':id')
  @ApiOperation({
    summary: 'Update own profile',
    description:
      'Only firstName, lastName, phone, bio and location can be changed. ' +
      'Email, role and trustScore are rejected.',
  })
  @ApiResponse({ status: 400, description: 'Unknown or read-only field' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthRequest,
  ) {
    this.checkOwnership(req, id);
    return this.usersService.updateProfile(id, dto);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post(':id/avatar')
  @ApiOperation({
    summary: 'Upload an avatar',
    description:
      'JPEG, PNG or WebP up to 5 MB. The file type is verified from its ' +
      'magic bytes; SVG and renamed binaries are rejected with 415. ' +
      'Cloudinary re-encodes the image and strips EXIF metadata.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { avatar: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 415, description: 'Unsupported image format' })
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: MAX_AVATAR_SIZE_BYTES },
    }),
  )
  async uploadAvatar(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
  ) {
    this.checkOwnership(req, id);

    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }

    // Content sniffing, not the client-provided mimetype/filename.
    assertSupportedAvatar(file.buffer);

    const upload = await this.cloudinary.uploadAvatar(file.buffer, 'users');

    return this.usersService.updateAvatar(id, {
      url: upload.secure_url,
      publicId: upload.public_id,
    });
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete an account',
    description:
      'Soft-deletes the account and anonymises all personal data. ' +
      'Blocked with code ACCOUNT_DELETION_BLOCKED while the user has an ' +
      'active custody, an open dispute or a funded escrow. Deleting your ' +
      'own account requires password re-authentication.',
  })
  @ApiResponse({ status: 401, description: 'Wrong password' })
  @ApiResponse({
    status: 409,
    description:
      'ACCOUNT_DELETION_BLOCKED (with reasons) or ACCOUNT_ALREADY_DELETED',
  })
  async deleteProfile(
    @Param('id') id: string,
    @Body() dto: DeleteAccountDto,
    @Req() req: AuthRequest,
  ) {
    const requester = this.checkOwnership(req, id);
    return this.usersService.deleteProfile(id, dto ?? {}, {
      actorId: requester.id,
      isSelf: requester.id === id,
    });
  }

  @Post(':id/suspend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspend a user account (Admin only)',
    description:
      'Blocks the account immediately: the suspended user cannot authenticate with an existing token and their pet listings are removed from public search.',
  })
  @ApiResponse({ status: 200, description: 'User suspended' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User is already suspended' })
  async suspend(
    @Param('id') id: string,
    @Body() dto: SuspendUserDto,
    @Req() req: AuthRequest,
  ) {
    return this.usersService.suspend(id, dto.reason, this.actorId(req));
  }

  @Post(':id/reinstate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reinstate a suspended user account (Admin only)',
    description:
      'Restores ACTIVE status, clears suspension metadata and lets the user authenticate and list pets again.',
  })
  @ApiResponse({ status: 200, description: 'User reinstated' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User is not suspended' })
  async reinstate(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.usersService.reinstate(id, this.actorId(req));
  }
}
