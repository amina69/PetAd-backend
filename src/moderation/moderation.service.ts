import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CreateReportDto } from './dto/create-report.dto';
import { TriageReportDto, ReportActionType } from './dto/triage-report.dto';
import { EventEntityType, EventType, ReportStatus, ReportTargetType, Prisma } from '@prisma/client';

@Injectable()
class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  async createReport(reporterId: string, dto: CreateReportDto) {
    const existingOpen = await this.prisma.report.findFirst({
      where: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        status: ReportStatus.OPEN,
      },
    });

    if (existingOpen) {
      throw new ConflictException('You already have an open report for this target.');
    }

    let contentSnapshot: any = {};
    try {
      if (dto.targetType === ReportTargetType.PET) {
        const pet = await this.prisma.pet.findUnique({ where: { id: dto.targetId } });
        if (pet) contentSnapshot = pet;
      } else if (dto.targetType === ReportTargetType.USER) {
        const u = await this.prisma.user.findUnique({ where: { id: dto.targetId }, select: { id: true, email: true, firstName: true, lastName: true } });
        if (u) contentSnapshot = u;
      }
    } catch (e) {
      // fallback
    }

    try {
      const report = await this.prisma.report.create({
        data: {
          reporterId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          reason: dto.reason,
          details: dto.details,
          status: ReportStatus.OPEN,
          contentSnapshot,
        },
      });

      await this.eventsService.logEvent({
        entityType: EventEntityType.USER,
        entityId: report.id,
        eventType: EventType.REPORT_CREATED,
        actorId: reporterId,
        payload: {
          reportId: report.id,
          targetType: dto.targetType,
          targetId: dto.targetId,
          reason: dto.reason,
        } as Prisma.InputJsonValue,
      });

      return report;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('You already have an open report for this target.');
      }
      throw error;
    }
  }

  async listReports(status?: ReportStatus) {
    return this.prisma.report.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        handledBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async triageReport(reportId: string, adminId: string, dto: TriageReportDto) {
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({
        where: { id: reportId },
      });

      if (!report) {
        throw new NotFoundException(`Report with id ${reportId} not found.`);
      }

      let newStatus: ReportStatus = ReportStatus.OPEN;

      switch (dto.action) {
        case ReportActionType.DISMISS:
          newStatus = ReportStatus.DISMISSED;
          break;
        case ReportActionType.WARN:
          newStatus = ReportStatus.WARNED;
          break;
        case ReportActionType.HIDE_CONTENT:
          newStatus = ReportStatus.CONTENT_HIDDEN;
          if (report.targetType === ReportTargetType.PET) {
            await tx.pet.update({
              where: { id: report.targetId },
              data: { isHidden: true } as any,
            }).catch(() => {});
          }
          break;
        case ReportActionType.SUSPEND_USER:
          newStatus = ReportStatus.USER_SUSPENDED;
          const userIdToSuspend = report.targetType === ReportTargetType.USER ? report.targetId : null;
          if (userIdToSuspend) {
            await tx.user.update({
              where: { id: userIdToSuspend },
              data: { status: 'SUSPENDED' } as any,
            }).catch(() => {});
          }
          break;
        default:
          throw new BadRequestException('Invalid triage action');
      }

      const updated = await tx.report.update({
        where: { id: reportId },
        data: {
          status: newStatus,
          handledById: adminId,
        },
      });

      await this.eventsService.logEvent({
        entityType: EventEntityType.USER,
        entityId: reportId,
        eventType: EventType.REPORT_RESOLVED,
        actorId: adminId,
        payload: {
          reportId,
          action: dto.action,
          newStatus,
          adminId,
        } as Prisma.InputJsonValue,
      });

      return updated;
    });
  }

  async unhideContent(reportId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({
        where: { id: reportId },
      });

      if (!report) {
        throw new NotFoundException(`Report with id ${reportId} not found.`);
      }

      if (report.targetType === ReportTargetType.PET) {
        await tx.pet.update({
          where: { id: report.targetId },
          data: { isHidden: false } as any,
        }).catch(() => {});
      }

      const updated = await tx.report.update({
        where: { id: reportId },
        data: {
          status: ReportStatus.DISMISSED,
          handledById: adminId,
        },
      });

      await this.eventsService.logEvent({
        entityType: EventEntityType.USER,
        entityId: reportId,
        eventType: EventType.CONTENT_RESTORED,
        actorId: adminId,
        payload: {
          reportId,
          adminId,
        } as Prisma.InputJsonValue,
      });

      return updated;
    });
  }
}

export { ModerationService };
