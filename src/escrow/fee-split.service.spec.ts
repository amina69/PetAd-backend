import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  FeeSplitService,
  splitAmount,
  xlmToStroops,
  validateStellarAddress,
  STROOPS_PER_XLM,
} from './fee-split.service';
import { PrismaService } from '../prisma/prisma.service';

const VALID_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

describe('splitAmount', () => {
  it('splits 100 XLM at 2% correctly', () => {
    const total = xlmToStroops(100);
    const { platformFeeStroops, recipientStroops } = splitAmount(total, 200);
    expect(platformFeeStroops).toBe(2n * STROOPS_PER_XLM);
    expect(recipientStroops).toBe(98n * STROOPS_PER_XLM);
    expect(platformFeeStroops + recipientStroops).toBe(total);
  });

  it('invariant holds for many odd values', () => {
    for (let i = 1n; i <= 1000n; i++) {
      const { platformFeeStroops, recipientStroops } = splitAmount(i, 200);
      expect(platformFeeStroops + recipientStroops).toBe(i);
    }
  });

  it('fee is floored — recipient gets at least nominal', () => {
    const { platformFeeStroops, recipientStroops } = splitAmount(1n, 200);
    expect(platformFeeStroops).toBe(0n);
    expect(recipientStroops).toBe(1n);
  });

  it('zero fee bps gives all to recipient', () => {
    const total = xlmToStroops(50);
    const { platformFeeStroops, recipientStroops } = splitAmount(total, 0);
    expect(platformFeeStroops).toBe(0n);
    expect(recipientStroops).toBe(total);
  });
});

describe('xlmToStroops', () => {
  it('converts integer XLM', () => {
    expect(xlmToStroops(1)).toBe(10_000_000n);
    expect(xlmToStroops(100)).toBe(1_000_000_000n);
  });

  it('converts decimal XLM', () => {
    expect(xlmToStroops('1.5')).toBe(15_000_000n);
    expect(xlmToStroops('0.0000001')).toBe(1n);
  });

  it('handles 7 decimal places', () => {
    expect(xlmToStroops('1.1234567')).toBe(11_234_567n);
  });
});

describe('validateStellarAddress', () => {
  it('passes a valid G-address', () => {
    expect(() => validateStellarAddress(VALID_ADDRESS)).not.toThrow();
  });

  it('rejects an address that does not start with G', () => {
    expect(() =>
      validateStellarAddress('SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'),
    ).toThrow(BadRequestException);
  });

  it('rejects an address that is too short', () => {
    expect(() => validateStellarAddress('GAAZI4TCR3TY5OJHCTJC2A4QSY6')).toThrow(
      BadRequestException,
    );
  });

  it('rejects an address with invalid chars', () => {
    expect(() =>
      validateStellarAddress('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOC000'),
    ).toThrow(BadRequestException);
  });
});

describe('FeeSplitService', () => {
  let service: FeeSplitService;

  const mockEscrow = { id: 'e1', amount: { toString: () => '100' } };
  const mockUser = { id: 'u1', stellarPublicKey: VALID_ADDRESS };

  const mockPrisma = {
    escrow: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const mockConfig = { get: jest.fn().mockReturnValue(200) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeSplitService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<FeeSplitService>(FeeSplitService);
  });

  it('throws NotFoundException when escrow is missing', async () => {
    mockPrisma.escrow.findUnique.mockResolvedValueOnce(null);
    await expect(service.computePayout('missing', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when user is missing', async () => {
    mockPrisma.escrow.findUnique.mockResolvedValueOnce(mockEscrow);
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.computePayout('e1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException with PAYOUT_ACCOUNT_REQUIRED when no stellar key', async () => {
    mockPrisma.escrow.findUnique.mockResolvedValueOnce(mockEscrow);
    mockPrisma.user.findUnique.mockResolvedValueOnce({ stellarPublicKey: null });
    const err = await service.computePayout('e1', 'u1').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.response.code).toBe('PAYOUT_ACCOUNT_REQUIRED');
  });

  it('returns correct split for 100 XLM at 2%', async () => {
    mockPrisma.escrow.findUnique.mockResolvedValueOnce(mockEscrow);
    mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
    const result = await service.computePayout('e1', 'u1');
    expect(result.platformFeeStroops).toBe(2n * STROOPS_PER_XLM);
    expect(result.recipientStroops).toBe(98n * STROOPS_PER_XLM);
    expect(result.recipientAddress).toBe(VALID_ADDRESS);
    expect(result.platformFeeStroops + result.recipientStroops).toBe(result.totalStroops);
  });
});
