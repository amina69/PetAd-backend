import {
  DocumentPolicyResource,
  isAdmin,
  PolicyAction,
  PolicyActor,
  PolicySubject,
  ResourcePolicy,
} from './policy.types';

export class DocumentPolicy implements ResourcePolicy<DocumentPolicyResource> {
  readonly subject = PolicySubject.DOCUMENT;

  allows(
    actor: PolicyActor,
    document: DocumentPolicyResource,
    action: PolicyAction,
  ): boolean {
    if (isAdmin(actor)) {
      return true;
    }

    const isUploader = document.uploadedById === actor.userId;
    const isAdoptionParty =
      document.adoption?.adopterId === actor.userId ||
      document.adoption?.ownerId === actor.userId;
    const isCustodyParty =
      document.custody?.holderId === actor.userId ||
      document.custody?.pet?.currentOwnerId === actor.userId;
    const isDisputeParticipant =
      document.dispute?.participants?.some((p) => p.userId === actor.userId);

    if (!isUploader && !isAdoptionParty && !isCustodyParty && !isDisputeParticipant) {
      return false;
    }

    switch (action) {
      case PolicyAction.READ:
        return true;
      case PolicyAction.DELETE:
        return isUploader;
      default:
        return false;
    }
  }
}
