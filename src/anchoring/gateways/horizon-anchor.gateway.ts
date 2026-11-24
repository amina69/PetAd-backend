import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  type AnchorGateway,
  type AnchorSubmission,
  type OnChainAnchor,
} from './anchor.gateway';

const BASE_FEE = '100000';
// One stroop (0.0000001 XLM) to self: the memo hash carries the anchor.
const ANCHOR_AMOUNT = '0.0000001';

/**
 * Real Stellar anchoring. The Merkle root is committed as the transaction
 * memo hash (32 bytes), which is what the public proof format points at.
 *
 * Verification only needs Horizon read access; submission additionally needs
 * the backend signing key (STELLAR_SECRET_KEY).
 */
@Injectable()
export class HorizonAnchorGateway implements AnchorGateway {
  constructor(private readonly configService: ConfigService) {}

  private get horizonUrl(): string {
    const url = this.configService.get<string>('stellar.horizonUrl');
    if (!url) {
      throw new Error('STELLAR_HORIZON_URL is required for Horizon anchoring');
    }
    return url.replace(/\/$/, '');
  }

  private get networkPassphrase(): string {
    const network = this.configService.get<string>(
      'stellar.network',
      'testnet',
    );
    switch (network) {
      case 'mainnet':
        return Networks.PUBLIC;
      case 'futurenet':
        return Networks.FUTURENET;
      default:
        return Networks.TESTNET;
    }
  }

  private get explorerBase(): string {
    const network = this.configService.get<string>(
      'stellar.network',
      'testnet',
    );
    return network === 'mainnet'
      ? 'https://stellar.expert/explorer/public'
      : `https://stellar.expert/explorer/${network}`;
  }

  explorerUrl(txHash: string): string {
    return `${this.explorerBase}/tx/${txHash}`;
  }

  async submitRoot(merkleRoot: string): Promise<AnchorSubmission> {
    if (!/^[a-f0-9]{64}$/i.test(merkleRoot)) {
      throw new Error('Merkle root must be a 32-byte hex string');
    }

    const secretKey = this.configService.get<string>('stellar.secretKey');
    const publicKey = this.configService.get<string>('stellar.publicKey');
    if (!secretKey || !publicKey) {
      throw new Error(
        'STELLAR_SECRET_KEY and STELLAR_PUBLIC_KEY are required to submit an anchor',
      );
    }

    const server = new Horizon.Server(this.horizonUrl);
    const source = await server.loadAccount(publicKey);

    const transaction = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: publicKey,
          asset: Asset.native(),
          amount: ANCHOR_AMOUNT,
        }),
      )
      .addMemo(Memo.hash(Buffer.from(merkleRoot, 'hex')))
      .setTimeout(60)
      .build();

    transaction.sign(Keypair.fromSecret(secretKey));

    const result = await server.submitTransaction(transaction);
    return {
      txHash: result.hash,
      explorerUrl: this.explorerUrl(result.hash),
    };
  }

  async fetchRoot(txHash: string): Promise<OnChainAnchor | null> {
    const response = await fetch(
      `${this.horizonUrl}/transactions/${encodeURIComponent(txHash)}`,
      { headers: { Accept: 'application/json' } },
    );

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Horizon returned HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      successful?: boolean;
      memo_type?: string;
      memo?: string;
      ledger?: number;
      created_at?: string;
    };

    if (body.successful === false) {
      return null;
    }
    if (body.memo_type !== 'hash' || !body.memo || !body.ledger) {
      return null;
    }

    const merkleRoot = Buffer.from(body.memo, 'base64').toString('hex');
    if (!/^[a-f0-9]{64}$/i.test(merkleRoot)) {
      return null;
    }

    return {
      merkleRoot: merkleRoot.toLowerCase(),
      blockHeight: Number(body.ledger),
      anchoredAt: body.created_at ? new Date(body.created_at) : new Date(),
    };
  }
}
