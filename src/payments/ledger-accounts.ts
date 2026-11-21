/**
 * Ledger account names used by payment postings.
 *
 * These are logical accounts (not Stellar accounts): each posting debits one
 * account and credits another, so every payment reconciles to zero.
 */
export const LEDGER_ACCOUNTS = {
  USER_WALLET: 'USER_WALLET',
  PROVIDER_CLEARING: 'PROVIDER_CLEARING',
  ESCROW: 'ESCROW',
  PLATFORM_FEE: 'PLATFORM_FEE',
  PENALTY: 'PENALTY',
  REFUND_PAYABLE: 'REFUND_PAYABLE',
} as const;
