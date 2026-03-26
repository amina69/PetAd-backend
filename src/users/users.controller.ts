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
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';

interface AuthRequest extends Request {
  user: {
    userId: string;
    role: string;
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

  private checkOwnership(req: AuthRequest, id: string) {
    if (req.user.userId !== id && req.user.role !== 'ADMIN') {
      throw new UnauthorizedException();
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user profile' })
  async getProfile(@Param('id') id: string, @Req() req: AuthRequest) {
    this.checkOwnership(req, id);
    return this.usersService.getProfile(id);
  }

  @Patch(':id')
  async updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthRequest,
  ) {
    this.checkOwnership(req, id);
    return this.usersService.updateProfile(id, dto);
  }

  @Post(':id/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png)$/)) {
          cb(new BadRequestException('Only JPG/PNG images allowed'), false);
        } else {
          cb(null, true);
        }
      },
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
    const upload = await this.cloudinary.uploadImage(file.buffer, 'users');

    return this.usersService.updateAvatar(id, upload.secure_url);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteProfile(@Param('id') id: string, @Req() req: AuthRequest) {
    this.checkOwnership(req, id);
    return this.usersService.deleteProfile(id);
  }
}
