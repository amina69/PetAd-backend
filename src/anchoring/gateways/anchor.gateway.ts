export const ANCHOR_GATEWAY = Symbol('ANCHOR_GATEWAY');

export interface AnchorSubmission {
  txHash: string;
  explorerUrl: string;
}

export interface OnChainAnchor {
  /** Hex-encoded 32-byte Merkle root committed in the transaction memo. */
  merkleRoot: string;
  blockHeight: number;
  anchoredAt: Date;
}

/**
 * Abstraction over the chain used by anchoring. The fake gateway is used in
 * tests and local development; the Horizon gateway fetches real chain data.
 */
export interface AnchorGateway {
  submitRoot(merkleRoot: string): Promise<AnchorSubmission>;
  fetchRoot(txHash: string): Promise<OnChainAnchor | null>;
  explorerUrl(txHash: string): string;
}
