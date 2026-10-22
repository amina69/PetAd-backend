import {
  Controller,
  Get,
  Patch,
  Delete,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
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
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  assertSupportedAvatar,
  MAX_AVATAR_SIZE_BYTES,
} from './utils/image-signature';

interface AuthRequest extends Request {
  user: {
    sub?: string;
    userId?: string;
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
}
