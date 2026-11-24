import { Role } from '../../auth/enums/role.enum';

export enum PolicyAction {
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  UPLOAD = 'UPLOAD',
  RETURN = 'RETURN',
  REPORT_VIOLATION = 'REPORT_VIOLATION',
}

export enum PolicySubject {
  ADOPTION = 'ADOPTION',
  CUSTODY = 'CUSTODY',
  DOCUMENT = 'DOCUMENT',
}

export interface PolicyActor {
  userId: string;
  role: Role | string;
}

export interface PolicyRequirement {
  action: PolicyAction;
  subject: PolicySubject;
  param: string;
}

export interface AdoptionPolicyResource {
  id: string;
  adopterId: string;
  ownerId: string;
}

export interface CustodyPolicyResource {
  id: string;
  holderId: string;
  pet: { currentOwnerId: string | null } | null;
}

export interface DocumentPolicyResource {
  id: string;
  uploadedById: string;
  adoption: { adopterId: string; ownerId: string } | null;
  conversationParticipantIds?: string[];
  profileOwnerId?: string | null;
}

export interface ResourcePolicy<TResource> {
  readonly subject: PolicySubject;
  allows(
    actor: PolicyActor,
    resource: TResource,
    action: PolicyAction,
  ): boolean;
}

const ADMIN_ROLE: string = Role.ADMIN;

export function isAdmin(actor: PolicyActor): boolean {
  return actor.role === ADMIN_ROLE;
}
