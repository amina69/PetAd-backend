
// import { Injectable, InternalServerErrorException } from '@nestjs/common';
// import { PrismaService } from '../../src/prisma/prisma.service';

// export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

// @Injectable()
// export class LoggingService {
//   constructor(private readonly prisma: PrismaService) {}

//   async log(params: {
//     level: LogLevel;
//     action: string;
//     message: string;
//     userId?: string;
//     metadata?: Record<string, any>;
//   }) {

//     try {
//       return await this.prisma.appLog.create({
//         data: {
//           level: params.level,
//           action: params.action,
//           message: params.message,
//           userId: params.userId,
//           metadata: params.metadata,
//         },
//       });
//     } catch (error) {
//       // ❗ Acceptance Criteria: no silent failures
//       throw new InternalServerErrorException(
//         'Failed to record application log',
//       );
//     }
//   }
// }



import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

@Injectable()
export class LoggingService {
  private readonly logger = new Logger(LoggingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    level: LogLevel;
    action: string;
    message: string;
    userId?: string;
    metadata?: Record<string, any>;
  }) {
    try {
      return await this.prisma.appLog.create({
        data: {
          level: params.level,
          action: params.action,
          message: params.message,
          userId: params.userId,
          metadata: params.metadata,
        },
      });
    } catch (error) {
      // Surface the failure visibly without crashing the caller
      this.logger.error(
        `Failed to record application log | action: ${params.action} | ${error?.message}`,
        error?.stack,
      );
      // Return null so callers can optionally handle it
      return null;
    }
  }
}