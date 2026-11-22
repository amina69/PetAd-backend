import { Role } from '../../auth/enums/role.enum';
import { AdoptionPolicy } from './adoption.policy';
import { CustodyPolicy } from './custody.policy';
import { DocumentPolicy } from './document.policy';
import {
  AdoptionPolicyResource,
  CustodyPolicyResource,
  DocumentPolicyResource,
  PolicyAction,
  PolicyActor,
} from './policy.types';

const ADMIN: PolicyActor = { userId: 'admin-1', role: Role.ADMIN };
const ADOPTER: PolicyActor = { userId: 'adopter-1', role: Role.USER };
const OWNER: PolicyActor = { userId: 'owner-1', role: Role.SHELTER };
const HOLDER: PolicyActor = { userId: 'holder-1', role: Role.USER };
const UPLOADER: PolicyActor = { userId: 'uploader-1', role: Role.SHELTER };
const STRANGER: PolicyActor = { userId: 'stranger-1', role: Role.USER };
const STRANGER_SHELTER: PolicyActor = {
  userId: 'stranger-shelter',
  role: Role.SHELTER,
};

const adoption: AdoptionPolicyResource = {
  id: 'adoption-1',
  adopterId: ADOPTER.userId,
  ownerId: OWNER.userId,
};

const custody: CustodyPolicyResource = {
  id: 'custody-1',
  holderId: HOLDER.userId,
  pet: { currentOwnerId: OWNER.userId },
};

const document: DocumentPolicyResource = {
  id: 'document-1',
  uploadedById: UPLOADER.userId,
  adoption: { adopterId: ADOPTER.userId, ownerId: OWNER.userId },
};

describe('Resource policies (role × resource × action)', () => {
  describe('AdoptionPolicy', () => {
    const policy = new AdoptionPolicy();

    const cases: Array<[string, PolicyActor, PolicyAction, boolean]> = [
      ['admin READ', ADMIN, PolicyAction.READ, true],
      ['admin UPDATE', ADMIN, PolicyAction.UPDATE, true],
      ['admin UPLOAD', ADMIN, PolicyAction.UPLOAD, true],
      ['admin DELETE', ADMIN, PolicyAction.DELETE, true],
      ['adopter READ', ADOPTER, PolicyAction.READ, true],
      ['adopter UPDATE', ADOPTER, PolicyAction.UPDATE, true],
      ['adopter UPLOAD', ADOPTER, PolicyAction.UPLOAD, true],
      ['adopter DELETE', ADOPTER, PolicyAction.DELETE, false],
      ['owner READ', OWNER, PolicyAction.READ, true],
      ['owner UPDATE', OWNER, PolicyAction.UPDATE, true],
      ['owner UPLOAD', OWNER, PolicyAction.UPLOAD, true],
      ['owner DELETE', OWNER, PolicyAction.DELETE, false],
      ['stranger READ', STRANGER, PolicyAction.READ, false],
      ['stranger UPDATE', STRANGER, PolicyAction.UPDATE, false],
      ['stranger UPLOAD', STRANGER, PolicyAction.UPLOAD, false],
      ['stranger DELETE', STRANGER, PolicyAction.DELETE, false],
      ['shelter non-party READ', STRANGER_SHELTER, PolicyAction.READ, false],
    ];

    it.each(cases)('%s', (_label, actor, action, expected) => {
      expect(policy.allows(actor, adoption, action)).toBe(expected);
    });
  });

  describe('CustodyPolicy', () => {
    const policy = new CustodyPolicy();

    const cases: Array<[string, PolicyActor, PolicyAction, boolean]> = [
      ['admin READ', ADMIN, PolicyAction.READ, true],
      ['admin UPDATE', ADMIN, PolicyAction.UPDATE, true],
      ['admin RETURN', ADMIN, PolicyAction.RETURN, true],
      ['admin REPORT_VIOLATION', ADMIN, PolicyAction.REPORT_VIOLATION, true],
      ['admin DELETE', ADMIN, PolicyAction.DELETE, true],
      ['holder READ', HOLDER, PolicyAction.READ, true],
      ['holder UPDATE', HOLDER, PolicyAction.UPDATE, true],
      ['holder RETURN', HOLDER, PolicyAction.RETURN, true],
      ['holder REPORT_VIOLATION', HOLDER, PolicyAction.REPORT_VIOLATION, true],
      ['holder DELETE', HOLDER, PolicyAction.DELETE, false],
      ['owner READ', OWNER, PolicyAction.READ, true],
      ['owner UPDATE', OWNER, PolicyAction.UPDATE, true],
      ['owner RETURN', OWNER, PolicyAction.RETURN, false],
      ['owner REPORT_VIOLATION', OWNER, PolicyAction.REPORT_VIOLATION, true],
      ['owner DELETE', OWNER, PolicyAction.DELETE, false],
      ['stranger READ', STRANGER, PolicyAction.READ, false],
      ['stranger RETURN', STRANGER, PolicyAction.RETURN, false],
      [
        'stranger REPORT_VIOLATION',
        STRANGER,
        PolicyAction.REPORT_VIOLATION,
        false,
      ],
    ];

    it.each(cases)('%s', (_label, actor, action, expected) => {
      expect(policy.allows(actor, custody, action)).toBe(expected);
    });

    it('denies a custody record without a pet relation to non-holders', () => {
      expect(
        policy.allows(OWNER, { ...custody, pet: null }, PolicyAction.READ),
      ).toBe(false);
    });
  });

  describe('DocumentPolicy', () => {
    const policy = new DocumentPolicy();

    const custodyParty: PolicyActor = { userId: 'holder-1', role: Role.USER };
    const disputeParticipant: PolicyActor = { userId: 'dispute-user-1', role: Role.USER };

    const complexDocument: DocumentPolicyResource = {
      id: 'doc-complex',
      uploadedById: UPLOADER.userId,
      kind: 'ID',
      adoption: { adopterId: ADOPTER.userId, ownerId: OWNER.userId },
      custody: { holderId: 'holder-1', pet: { currentOwnerId: OWNER.userId } },
      dispute: { participants: [{ userId: 'dispute-user-1' }] },
    };

    const cases: Array<[string, PolicyActor, PolicyAction, boolean]> = [
      ['admin READ', ADMIN, PolicyAction.READ, true],
      ['admin UPDATE', ADMIN, PolicyAction.UPDATE, true],
      ['admin DELETE', ADMIN, PolicyAction.DELETE, true],
      ['uploader READ', UPLOADER, PolicyAction.READ, true],
      ['uploader UPDATE', UPLOADER, PolicyAction.UPDATE, false],
      ['uploader DELETE', UPLOADER, PolicyAction.DELETE, true],
      ['adopter READ', ADOPTER, PolicyAction.READ, true],
      ['adopter DELETE', ADOPTER, PolicyAction.DELETE, false],
      ['owner READ', OWNER, PolicyAction.READ, true],
      ['owner DELETE', OWNER, PolicyAction.DELETE, false],
      ['custody holder READ', custodyParty, PolicyAction.READ, true],
      ['dispute participant READ', disputeParticipant, PolicyAction.READ, true],
      ['stranger READ', STRANGER, PolicyAction.READ, false],
      ['stranger DELETE', STRANGER, PolicyAction.DELETE, false],
      ['shelter non-party READ', STRANGER_SHELTER, PolicyAction.READ, false],
    ];

    it.each(cases)('%s', (_label, actor, action, expected) => {
      expect(policy.allows(actor, complexDocument, action)).toBe(expected);
    });
  });
});
