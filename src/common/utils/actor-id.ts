import { BadRequestException } from '@nestjs/common';

export function getActorId(user: unknown): string {
  const candidate = user as
    | { userId?: string; sub?: string; id?: string }
    | undefined;
  const actorId = candidate?.userId ?? candidate?.sub ?? candidate?.id;

  if (!actorId) {
    throw new BadRequestException(
      'Authenticated user id is missing; the action cannot be audit-logged.',
    );
  }

  return actorId;
}
