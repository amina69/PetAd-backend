import { NotFoundException } from '@nestjs/common';
import { DocumentEntityType, Prisma, PrismaClient } from '@prisma/client';
import { AdoptionPolicy } from './adoption.policy';
import { CustodyPolicy } from './custody.policy';
import { DocumentPolicy } from './document.policy';
import {
  AdoptionPolicyResource,
  CustodyPolicyResource,
  DocumentPolicyResource,
  isAdmin,
  PolicyActor,
  PolicyRequirement,
  PolicySubject,
} from './policy.types';

type PolicyPrisma = Pick<PrismaClient, 'adoption' | 'custody' | 'document'>;

const adoptionPolicy = new AdoptionPolicy();
const custodyPolicy = new CustodyPolicy();
const documentPolicy = new DocumentPolicy();

async function findOrNotFound<T>(
  query: () => Promise<T>,
  resourceName: string,
): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException(`${resourceName} not found`);
    }
    throw error;
  }
}

export function loadAdoptionForActor(
  prisma: PolicyPrisma,
  actor: PolicyActor,
  adoptionId: string,
): Promise<AdoptionPolicyResource> {
  const where: Prisma.AdoptionWhereInput = { id: adoptionId };

  if (!isAdmin(actor)) {
    where.OR = [{ adopterId: actor.userId }, { ownerId: actor.userId }];
  }

  return findOrNotFound(
    () =>
      prisma.adoption.findFirstOrThrow({
        where,
        select: { id: true, adopterId: true, ownerId: true },
      }),
    'Adoption',
  );
}

export function loadCustodyForActor(
  prisma: PolicyPrisma,
  actor: PolicyActor,
  custodyId: string,
): Promise<CustodyPolicyResource> {
  const where: Prisma.CustodyWhereInput = { id: custodyId };

  if (!isAdmin(actor)) {
    where.OR = [
      { holderId: actor.userId },
      { pet: { currentOwnerId: actor.userId } },
    ];
  }

  return findOrNotFound(
    () =>
      prisma.custody.findFirstOrThrow({
        where,
        select: {
          id: true,
          holderId: true,
          pet: { select: { currentOwnerId: true } },
        },
      }),
    'Custody',
  );
}

export async function loadDocumentForActor(
  prisma: PolicyPrisma,
  actor: PolicyActor,
  documentId: string,
): Promise<DocumentPolicyResource> {
  const where: Prisma.DocumentWhereInput = { id: documentId };

  if (!isAdmin(actor)) {
    where.OR = [
      { uploadedById: actor.userId },
      { adoption: { adopterId: actor.userId } },
      { adoption: { ownerId: actor.userId } },
      {
        messageAttachment: {
          message: {
            conversation: {
              OR: [
                { participantOneId: actor.userId },
                { participantTwoId: actor.userId },
              ],
            },
          },
        },
      },
      {
        entityType: DocumentEntityType.PROFILE,
        entityId: actor.userId,
      },
    ];
  }

  const document = await findOrNotFound(
    () =>
      prisma.document.findFirstOrThrow({
        where,
        select: {
          id: true,
          uploadedById: true,
          entityType: true,
          entityId: true,
          adoption: { select: { adopterId: true, ownerId: true } },
          messageAttachment: {
            select: {
              message: {
                select: {
                  conversation: {
                    select: {
                      participantOneId: true,
                      participantTwoId: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    'Document',
  );

  const conversation = document.messageAttachment?.message.conversation;

  return {
    id: document.id,
    uploadedById: document.uploadedById,
    adoption: document.adoption,
    conversationParticipantIds: conversation
      ? [conversation.participantOneId, conversation.participantTwoId]
      : [],
    profileOwnerId:
      document.entityType === DocumentEntityType.PROFILE
        ? document.entityId
        : null,
  };
}

export async function enforcePolicy(
  prisma: PolicyPrisma,
  requirement: PolicyRequirement,
  actor: PolicyActor,
  resourceId: string,
): Promise<void> {
  switch (requirement.subject) {
    case PolicySubject.ADOPTION: {
      const adoption = await loadAdoptionForActor(prisma, actor, resourceId);
      if (!adoptionPolicy.allows(actor, adoption, requirement.action)) {
        throw new NotFoundException('Adoption not found');
      }
      return;
    }

    case PolicySubject.CUSTODY: {
      const custody = await loadCustodyForActor(prisma, actor, resourceId);
      if (!custodyPolicy.allows(actor, custody, requirement.action)) {
        throw new NotFoundException('Custody not found');
      }
      return;
    }

    case PolicySubject.DOCUMENT: {
      const document = await loadDocumentForActor(prisma, actor, resourceId);
      if (!documentPolicy.allows(actor, document, requirement.action)) {
        throw new NotFoundException('Document not found');
      }
      return;
    }

    default:
      throw new NotFoundException('Resource not found');
  }
}
