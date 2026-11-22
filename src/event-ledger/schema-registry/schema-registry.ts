import { EventType } from '@prisma/client';

export type PayloadUpcaster = (payload: Record<string, unknown>) => Record<string, unknown>;

interface SchemaDefinition {
  validate: (payload: Record<string, unknown>) => boolean;
  upcaster?: PayloadUpcaster;
}

const SCHEMAS: Partial<Record<EventType, Record<number, SchemaDefinition>>> = {
  [EventType.ADOPTION_REQUESTED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null && typeof p.petId === 'string' && typeof p.adopterId === 'string',
    },
  },
  [EventType.ADOPTION_APPROVED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null && typeof p.adoptionId === 'string',
    },
  },
  [EventType.ADOPTION_COMPLETED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null && typeof p.adoptionId === 'string',
    },
  },
  [EventType.ADOPTION_REJECTED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null && typeof p.adoptionId === 'string',
    },
  },
  [EventType.ADOPTION_CANCELLED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null && typeof p.adoptionId === 'string',
    },
  },
  [EventType.PET_REGISTERED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.CUSTODY_STARTED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.CUSTODY_RETURNED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.CUSTODY_VIOLATION]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.CUSTODY_CANCELLED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.ESCROW_CREATED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.ESCROW_FUNDED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.ESCROW_RELEASED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.ESCROW_REFUNDED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.TRUST_SCORE_UPDATED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.USER_REGISTERED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.PET_LISTED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.PET_ADOPTED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.PET_CUSTODY_ACTIVE]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.PET_RETURNED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.CUSTODY_CREATED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.CUSTODY_COMPLETED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.PET_CUSTODY_CANCELLED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.CUSTODY_EXTENDED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.USER_SUSPENDED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.USER_REINSTATED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
  [EventType.USER_DELETED]: {
    1: {
      validate: (p) => typeof p === 'object' && p !== null,
    },
  },
};

export class SchemaRegistry {
  static getLatestVersion(eventType: EventType): number {
    const versions = SCHEMAS[eventType];
    if (!versions) return 1;
    const keys = Object.keys(versions).map(Number);
    return Math.max(...keys, 1);
  }

  static validateAndUpcast(eventType: EventType, version: number, payload: Record<string, unknown>): Record<string, unknown> {
    const typeSchemas = SCHEMAS[eventType];
    if (!typeSchemas) {
      return payload;
    }

    let currentVersion = version;
    let currentPayload = { ...payload };

    const def = typeSchemas[currentVersion];
    if (def) {
      if (!def.validate(currentPayload)) {
        throw new Error(`Event payload validation failed for ${eventType} v${currentVersion}`);
      }
    }

    const latest = SchemaRegistry.getLatestVersion(eventType);
    while (currentVersion < latest) {
      const stepDef = typeSchemas[currentVersion];
      if (stepDef && stepDef.upcaster) {
        currentPayload = stepDef.upcaster(currentPayload);
      }
      currentVersion += 1;
    }

    return currentPayload;
  }

  static validatePayload(eventType: EventType, version: number, payload: Record<string, unknown>): void {
    const typeSchemas = SCHEMAS[eventType];
    if (!typeSchemas) return;
    const def = typeSchemas[version];
    if (def) {
      if (!def.validate(payload)) {
        throw new Error(`Event payload validation failed for ${eventType} v${version}`);
      }
    } else {
      throw new Error(`Event payload validation failed for ${eventType} v${version}`);
    }
  }

  static verifyAllEventTypesCovered(allEventTypes: EventType[]): void {
    for (const et of allEventTypes) {
      if (!SCHEMAS[et]) {
        throw new Error(`EventType ${et} is missing a registered schema in SchemaRegistry.`);
      }
    }
  }
}
