/**
 * Declarative notification templates.
 *
 * `subject`, `message` and `route` are Handlebars strings rendered against
 * the event context (pet/adoption/custody/escrow + recipient). Adding a new
 * template means adding an entry here plus a rule in notification-rules.ts;
 * no service code changes.
 */
export interface NotificationTemplateDefinition {
  subject: string;
  message: string;
  route?: string;
}

export const NOTIFICATION_TEMPLATES: Record<
  string,
  NotificationTemplateDefinition
> = {
  'adoption-requested-owner': {
    subject: 'New adoption request for {{petName}}',
    message:
      '{{adopterName}} submitted an adoption request for {{petName}}. Review the request and documents in your dashboard.',
    route: '/adoptions/{{adoptionId}}',
  },
  'adoption-requested-adopter': {
    subject: 'Adoption request submitted for {{petName}}',
    message:
      'Your adoption request for {{petName}} was submitted and is awaiting review.',
    route: '/adoptions/{{adoptionId}}',
  },
  'adoption-approved-adopter': {
    subject: 'Your adoption request for {{petName}} was approved',
    message:
      'Good news — your adoption request for {{petName}} was approved. Follow the next steps to complete the process.',
    route: '/adoptions/{{adoptionId}}',
  },
  'adoption-approved-owner': {
    subject: 'Adoption approved for {{petName}}',
    message:
      'The adoption request for {{petName}} has been approved. We will let you know when the process is complete.',
    route: '/adoptions/{{adoptionId}}',
  },
  'adoption-rejected-adopter': {
    subject: 'Update on your adoption request for {{petName}}',
    message:
      'Your adoption request for {{petName}} was not approved. You can browse other pets available for adoption.',
    route: '/adoptions/{{adoptionId}}',
  },
  'adoption-cancelled': {
    subject: 'Adoption request for {{petName}} was cancelled',
    message:
      'The adoption request for {{petName}} has been cancelled. No further action is needed.',
    route: '/adoptions/{{adoptionId}}',
  },
  'adoption-completed': {
    subject: 'Adoption of {{petName}} is complete',
    message:
      'The adoption of {{petName}} has been completed. Thank you for using PetAd.',
    route: '/adoptions/{{adoptionId}}',
  },
  'custody-created-holder': {
    subject: 'Custody agreement for {{petName}}',
    message:
      'A custody agreement for {{petName}} has been created. Review the dates and deposit before it starts.',
    route: '/custody/{{custodyId}}',
  },
  'custody-created-owner': {
    subject: 'Custody agreement created for {{petName}}',
    message:
      'A temporary custody agreement for {{petName}} has been created with {{holderName}}.',
    route: '/custody/{{custodyId}}',
  },
  'custody-started': {
    subject: 'Custody period for {{petName}} has started',
    message:
      'The custody period for {{petName}} has started. Remember to return the pet by the agreed end date.',
    route: '/custody/{{custodyId}}',
  },
  'custody-completed': {
    subject: 'Custody period for {{petName}} has ended',
    message:
      'The custody period for {{petName}} has been completed. Thank you for taking care of them.',
    route: '/custody/{{custodyId}}',
  },
  'custody-violation': {
    subject: 'Custody agreement issue for {{petName}}',
    message:
      'A problem was reported on the custody agreement for {{petName}}. Please review the details promptly.',
    route: '/custody/{{custodyId}}',
  },
  'escrow-update': {
    subject: 'Escrow update for {{petName}}',
    message:
      'There is an escrow update for {{petName}}. Check the agreement to see the latest status.',
    route: '/escrow/{{escrowId}}',
  },
  'user-registered': {
    subject: 'Welcome to PetAd',
    message:
      'Welcome to PetAd. Complete your profile to start adopting or listing pets.',
    route: '/profile',
  },
  'account-suspended': {
    subject: 'Your PetAd account has been suspended',
    message:
      'Your account has been suspended. Contact support if you believe this was a mistake.',
    route: '/support',
  },
  'account-reinstated': {
    subject: 'Your PetAd account has been reinstated',
    message:
      'Your account is active again. You can sign in and continue where you left off.',
    route: '/profile',
  },
  'pet-adopted': {
    subject: '{{petName}} has been adopted',
    message:
      '{{petName}} has found a new home. The adoption record is now complete.',
    route: '/pets/{{petId}}',
  },
  'pet-returned': {
    subject: '{{petName}} is available again',
    message: '{{petName}} is back and available for adoption.',
    route: '/pets/{{petId}}',
  },
};
