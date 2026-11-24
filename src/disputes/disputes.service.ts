import { Injectable } from '@nestjs/common';
import { DisputeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaginatedResponseDto,
  PaginationMetaDto,
} from '../common/dto/paginated-response.dto';
import { Role } from '../auth/enums/role.enum';
import { AdminListDisputesDto, ListDisputesDto } from './dto/list-disputes.dto';

export interface DisputeViewer {
  userId: string;
  role: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const PARTY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

const DISPUTE_INCLUDE = {
  raisedBy: { select: PARTY_SELECT },
  respondent: { select: PARTY_SELECT },
  assignee: { select: PARTY_SELECT },
} satisfies Prisma.DisputeInclude;

type DisputeWithParties = Prisma.DisputeGetPayload<{
  include: typeof DISPUTE_INCLUDE;
}>;

@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `GET /disputes`.
   *
   * Admins see every dispute; everyone else only sees disputes they raised
   * or are the respondent of. The party restriction is part of the query —
   * never applied after the fact.
   */
  async list(viewer: DisputeViewer, filters: ListDisputesDto) {
    return this.query(viewer, filters, false);
  }

  /**
   * `GET /admin/disputes`: same filters plus assignee and age (admin only,
   * enforced by the controller's role guard).
   */
  async listForAdmin(viewer: DisputeViewer, filters: AdminListDisputesDto) {
    return this.query(viewer, filters, true);
  }

  private async query(
    viewer: DisputeViewer,
    filters: AdminListDisputesDto,
    admin: boolean,
  ) {
    const {
      status,
      page = 1,
      limit = 20,
      sort = 'createdAt',
      order = 'desc',
    } = filters;

    const conditions: Prisma.DisputeWhereInput[] = [
      this.scopeFilter(viewer, admin),
      ...this.filterConditions(filters, viewer),
    ].filter((condition) => Object.keys(condition).length > 0);

    // `status` is deliberately excluded from the count query so tab counts
    // describe the same filtered set the tab switches between.
    const baseWhere: Prisma.DisputeWhereInput = { AND: conditions };
    const where: Prisma.DisputeWhereInput = status
      ? { AND: [...conditions, { status }] }
      : baseWhere;

    const skip = (page - 1) * limit;
    const orderBy = [
      { [sort]: order },
      { id: 'desc' },
    ] as Prisma.DisputeOrderByWithRelationInput[];

    const [rows, total, grouped] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        skip,
        take: limit,
        include: DISPUTE_INCLUDE,
        orderBy,
      }),
      this.prisma.dispute.count({ where }),
      this.prisma.dispute.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    // Seed every status with zero so the UI tabs are stable.
    const counts = Object.values(DisputeStatus).reduce<
      Record<DisputeStatus, number>
    >(
      (accumulator, value) => {
        accumulator[value] = 0;
        return accumulator;
      },
      {} as Record<DisputeStatus, number>,
    );

    for (const group of grouped) {
      counts[group.status] = group._count._all;
    }

    return {
      ...new PaginatedResponseDto<ReturnType<typeof toDisputeDto>>(
        rows.map(toDisputeDto),
        new PaginationMetaDto(page, limit, total),
      ),
      counts,
    };
  }

  private scopeFilter(
    viewer: DisputeViewer,
    admin: boolean,
  ): Prisma.DisputeWhereInput {
    if (admin || viewer.role === Role.ADMIN.toString()) {
      return {};
    }

    return {
      OR: [{ raisedById: viewer.userId }, { respondentId: viewer.userId }],
    };
  }

  private filterConditions(
    filters: AdminListDisputesDto,
    viewer: DisputeViewer,
  ): Prisma.DisputeWhereInput[] {
    const conditions: Prisma.DisputeWhereInput[] = [];

    if (filters.reason) {
      conditions.push({ reason: filters.reason });
    }
    if (filters.entityType) {
      conditions.push({ entityType: filters.entityType });
    }

    // Age is expressed as a createdAt window; min/max age can coexist with an
    // explicit date range and simply narrows it further.
    const createdAt: Prisma.DateTimeFilter = {};

    if (filters.dateFrom) {
      createdAt.gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      createdAt.lte = new Date(filters.dateTo);
    }

    if (filters.maxAgeDays !== undefined) {
      const boundary = new Date(Date.now() - filters.maxAgeDays * DAY_MS);
      if (!createdAt.gte || boundary > createdAt.gte) {
        createdAt.gte = boundary;
      }
    }
    if (filters.minAgeDays !== undefined) {
      const boundary = new Date(Date.now() - filters.minAgeDays * DAY_MS);
      if (!createdAt.lte || boundary < createdAt.lte) {
        createdAt.lte = boundary;
      }
    }

    if (filters.assignee === 'me') {
      conditions.push({ assigneeId: viewer.userId });
    } else if (filters.assignee === 'unassigned') {
      conditions.push({ assigneeId: null });
    } else if (filters.assignee) {
      conditions.push({ assigneeId: filters.assignee });
    }

    if (Object.keys(createdAt).length > 0) {
      conditions.push({ createdAt });
    }

    return conditions;
  }
}

function toDisputeDto(dispute: DisputeWithParties) {
  return {
    ...dispute,
    ageDays: Math.floor((Date.now() - dispute.createdAt.getTime()) / DAY_MS),
  };
}
