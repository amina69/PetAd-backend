import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreatePushSubscriptionDto {
  @IsUrl({ require_protocol: true })
  @IsNotEmpty()
  endpoint: string;

  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class DeletePushSubscriptionDto {
  @IsUrl({ require_protocol: true })
  @IsNotEmpty()
  endpoint: string;
}

export class PushSubscriptionResponseDto {
  id: string;
  endpoint: string;
  createdAt: Date;

  @IsOptional()
  userAgent?: string;
}
