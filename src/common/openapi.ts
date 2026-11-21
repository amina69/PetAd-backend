import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ErrorDetailDto, ErrorResponseDto } from './dto/error-response.dto';
import {
  ApprovalResponseDto,
  DisputeDto,
  MoneyDto,
  NotificationDto,
  PaymentDto,
} from './dto/api-contracts.dto';

export const API_PREFIX = 'api/v1';
export const SWAGGER_PATH = 'api';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const documentConfig = new DocumentBuilder()
    .setTitle('Pet Adoption API')
    .setDescription('API documentation for the Pet Adoption platform')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  return SwaggerModule.createDocument(app, documentConfig, {
    extraModels: [
      ErrorResponseDto,
      ErrorDetailDto,
      ApprovalResponseDto,
      DisputeDto,
      MoneyDto,
      NotificationDto,
      PaymentDto,
    ],
  });
}
