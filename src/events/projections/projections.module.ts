import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectionRunnerService } from './projection-runner.service';
import { ProjectionAdminController } from './projection-admin.controller';

@Module({
  imports: [PrismaModule],
  providers: [
    ProjectionRunnerService,
    {
      provide: 'REGISTERED_PROJECTIONS',
      useValue: [],
    },
    {
      provide: ProjectionAdminController,
      useFactory: (runner: ProjectionRunnerService, projections: any[]) => {
        return new ProjectionAdminController(runner, projections);
      },
      inject: [ProjectionRunnerService, 'REGISTERED_PROJECTIONS'],
    },
  ],
  controllers: [ProjectionAdminController],
  exports: [ProjectionRunnerService, 'REGISTERED_PROJECTIONS'],
})
export class ProjectionsModule {}
