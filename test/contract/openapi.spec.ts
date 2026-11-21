import * as fs from 'fs';
import * as path from 'path';
import { validateFixture } from './support/validate-against-openapi';

const documentPath = path.resolve(__dirname, '../../docs/openapi.json');
const document = JSON.parse(fs.readFileSync(documentPath, 'utf8')) as Record<
  string,
  any
>;

function schemaProperties(name: string): Record<string, unknown> {
  expect(document.components.schemas[name]).toBeDefined();
  return document.components.schemas[name].properties ?? {};
}

describe('exported OpenAPI contract', () => {
  it('matches the runtime Swagger metadata', () => {
    expect(document.info.title).toBe('Pet Adoption API');
    expect(document.info.version).toBe('1.0');
    expect(document.components.securitySchemes['JWT-auth']).toBeDefined();
    expect(Object.keys(document.paths)).toContain('/api/v1/adoption/{id}/approve');
    expect(Object.keys(document.paths)).toContain('/health');
    expect(Object.keys(document.paths).some((key) => key.startsWith('/api/v1'))).toBe(
      true,
    );
  });

  it('documents the shared error envelope', () => {
    const properties = schemaProperties('ErrorResponseDto');
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining([
        'statusCode',
        'code',
        'message',
        'details',
        'requestId',
        'timestamp',
        'path',
      ]),
    );
    expect(document.components.schemas.ErrorResponseDto.required).toEqual(
      expect.arrayContaining([
        'statusCode',
        'code',
        'message',
        'requestId',
        'timestamp',
        'path',
      ]),
    );
  });

  it('documents the response shapes the frontend depends on', () => {
    expect(Object.keys(schemaProperties('ApprovalResponseDto'))).toEqual(
      expect.arrayContaining([
        'id',
        'status',
        'petId',
        'adopterId',
        'ownerId',
        'pet',
        'adopter',
        'owner',
      ]),
    );
    expect(Object.keys(schemaProperties('CustodyResponseDto'))).toEqual(
      expect.arrayContaining([
        'id',
        'status',
        'type',
        'petId',
        'holderId',
        'depositAmount',
        'pet',
      ]),
    );
    expect(Object.keys(schemaProperties('DisputeDto'))).toEqual(
      expect.arrayContaining(['id', 'escrowId', 'status', 'openedAt']),
    );
    expect(Object.keys(schemaProperties('NotificationDto'))).toEqual(
      expect.arrayContaining(['id', 'type', 'title', 'message', 'createdAt']),
    );
    expect(Object.keys(schemaProperties('PaymentDto'))).toEqual(
      expect.arrayContaining(['id', 'escrowId', 'amount', 'status']),
    );
    expect(Object.keys(schemaProperties('MoneyDto'))).toEqual(['amount', 'currency']);
  });

  it('validates MSW-style fixtures against the exported schemas', () => {
    const fixtures: Array<[string, unknown]> = [
      [
        'ApprovalResponseDto',
        {
          id: 'approval-1',
          status: 'APPROVED',
          notes: null,
          petId: 'pet-1',
          adopterId: 'adopter-1',
          ownerId: 'owner-1',
          escrowId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          pet: { id: 'pet-1', name: 'Buddy', species: 'DOG', imageUrl: null },
          adopter: {
            id: 'adopter-1',
            firstName: 'A',
            lastName: 'B',
            email: 'a@example.com',
          },
          owner: {
            id: 'owner-1',
            firstName: 'C',
            lastName: 'D',
            email: 'c@example.com',
          },
        },
      ],
      [
        'CustodyResponseDto',
        {
          id: 'custody-1',
          status: 'ACTIVE',
          type: 'TEMPORARY',
          depositAmount: '100.00',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: null,
          petId: 'pet-1',
          holderId: 'holder-1',
          escrowId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          pet: {
            id: 'pet-1',
            name: 'Buddy',
            species: 'DOG',
            breed: null,
            age: 3,
            description: null,
            imageUrl: null,
          },
        },
      ],
      [
        'DisputeDto',
        {
          id: 'dispute-1',
          escrowId: 'escrow-1',
          adoptionId: null,
          status: 'OPEN',
          reason: null,
          openedAt: '2026-01-01T00:00:00.000Z',
          resolvedAt: null,
        },
      ],
      [
        'NotificationDto',
        {
          id: 'notification-1',
          type: 'ADOPTION_APPROVED',
          title: 'Approved',
          message: 'Your request was approved',
          readAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      [
        'PaymentDto',
        {
          id: 'payment-1',
          escrowId: 'escrow-1',
          amount: { amount: '100.00', currency: 'XLM' },
          status: 'FUNDED',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      [
        'ErrorResponseDto',
        {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: [{ message: 'email must be an email' }],
          requestId: 'request-1',
          timestamp: '2026-01-01T00:00:00.000Z',
          path: '/api/v1/auth/register',
        },
      ],
    ];

    for (const [schemaName, fixture] of fixtures) {
      expect(validateFixture(document, schemaName, fixture)).toEqual([]);
    }
  });

  it('rejects fixtures that remove a required response field', () => {
    const fixture = {
      id: 'payment-1',
      escrowId: 'escrow-1',
      status: 'FUNDED',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(validateFixture(document, 'PaymentDto', fixture)).toContain(
      'PaymentDto.amount is required',
    );
  });
});
