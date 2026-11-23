import { Injectable, NotFoundException } from '@nestjs/common';
import { AdoptionStatusAdapter } from './adapters/adoption-status.adapter';
import { CustodyStatusAdapter } from './adapters/custody-status.adapter';
import { EscrowStatusAdapter } from './adapters/escrow-status.adapter';
import type { StatusResponse } from './status.types';

export type EntityType = 'ADOPTION' | 'CUSTODY' | 'ESCROW';

@Injectable()
export class StatusService {
  constructor(
    private readonly adoptionAdapter: AdoptionStatusAdapter,
    private readonly custodyAdapter: CustodyStatusAdapter,
    private readonly escrowAdapter: EscrowStatusAdapter,
  ) {}

  async getStatus(entityType: EntityType, id: string): Promise<StatusResponse> {
    let result: StatusResponse | null = null;

    switch (entityType) {
      case 'ADOPTION':
        result = await this.adoptionAdapter.getStatus(id);
        break;
      case 'CUSTODY':
        result = await this.custodyAdapter.getStatus(id);
        break;
      case 'ESCROW':
        result = await this.escrowAdapter.getStatus(id);
        break;
    }

    if (!result) {
      throw new NotFoundException(`${entityType} with id "${id}" not found`);
    }

    return result;
  }
}
