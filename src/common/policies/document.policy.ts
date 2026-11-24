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
    const isParty =
      document.adoption?.adopterId === actor.userId ||
      document.adoption?.ownerId === actor.userId;
    const isConversationParticipant =
      document.conversationParticipantIds?.includes(actor.userId) ?? false;
    const isProfileOwner = document.profileOwnerId === actor.userId;

    if (
      !isUploader &&
      !isParty &&
      !isConversationParticipant &&
      !isProfileOwner
    ) {
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
