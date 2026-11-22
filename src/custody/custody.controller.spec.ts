import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CustodyController } from './custody.controller';
import { CustodyService } from './custody.service';
import type { CreateCustodyDto } from './dto/create-custody.dto';
import type { CustodyResponseDto } from './dto/custody-response.dto';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

describe('CustodyController request validation', () => {
  let app: INestApplication;
  const createCustody = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CustodyController],
      providers: [
        { provide: CustodyService, useValue: { createCustody } },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context) => {
          context.switchToHttp().getRequest().user = { userId: 'user-123' };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => createCustody.mockReset());

  it.each([
    { cardNumber: '4242424242424242' },
    { card: { number: '4242424242424242', cvc: '123' } },
    { cvv: '123' },
  ])('rejects raw card data before invoking the service: %j', async (card) => {
    await request(app.getHttpServer())
      .post('/custody')
      .send({
        petId: '550e8400-e29b-41d4-a716-446655440000',
        startDate: '2030-01-01T00:00:00.000Z',
        durationDays: 7,
        ...card,
      })
      .expect(400);
    expect(createCustody).not.toHaveBeenCalled();
  });

  it('accepts a valid request without card data', async () => {
    createCustody.mockResolvedValue({ id: 'custody-123' });
    await request(app.getHttpServer())
      .post('/custody')
      .send({
        petId: '550e8400-e29b-41d4-a716-446655440000',
        startDate: '2030-01-01T00:00:00.000Z',
        durationDays: 7,
      })
      .expect(201);
    expect(createCustody).toHaveBeenCalledTimes(1);
  });
});

describe('CustodyController', () => {
  let controller: CustodyController;
  let service: CustodyService;

  const mockCustodyService = {
    createCustody: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustodyController],
      providers: [
        {
          provide: CustodyService,
          useValue: mockCustodyService,
        },
        // Required by PoliciesGuard, which protects the custody endpoints.
        {
          provide: PrismaService,
          useValue: {
            custody: { findFirstOrThrow: jest.fn() },
          },
        },
      ],
    }).compile();

    controller = module.get<CustodyController>(CustodyController);
    service = module.get<CustodyService>(CustodyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createCustody', () => {
    it('should create a custody agreement successfully', async () => {
      const user: CurrentUserPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'USER',
      };

      const createDto: CreateCustodyDto = {
        petId: 'pet-123',
        startDate: '2024-12-25T00:00:00.000Z',
        durationDays: 14,
        depositAmount: 100.0,
      };

      const expectedResponse: CustodyResponseDto = {
        id: 'custody-123',
        status: 'PENDING',
        type: 'TEMPORARY',
        depositAmount: null,
        startDate: new Date('2024-12-25T00:00:00.000Z'),
        endDate: new Date('2025-01-08T00:00:00.000Z'),
        petId: 'pet-123',
        holderId: 'user-123',
        escrowId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        pet: {
          id: 'pet-123',
          name: 'Buddy',
          species: 'DOG',
          breed: 'Golden Retriever',
          age: 3,
          description: 'Friendly dog',
          imageUrl: null,
        },
      };

      mockCustodyService.createCustody.mockResolvedValue(expectedResponse);

      const result = await controller.createCustody(user, createDto);

      expect(result).toEqual(expectedResponse);
      expect(service.createCustody).toHaveBeenCalledWith(
        user.userId,
        createDto,
      );
      expect(service.createCustody).toHaveBeenCalledTimes(1);
    });

    it('should pass userId from JWT to service', async () => {
      const user: CurrentUserPayload = {
        userId: 'user-456',
        email: 'another@example.com',
        role: 'USER',
      };

      const createDto: CreateCustodyDto = {
        petId: 'pet-789',
        startDate: '2024-12-30T00:00:00.000Z',
        durationDays: 7,
      };

      const mockResponse: CustodyResponseDto = {
        id: 'custody-456',
        status: 'PENDING',
        type: 'TEMPORARY',
        depositAmount: null,
        startDate: new Date('2024-12-30T00:00:00.000Z'),
        endDate: new Date('2025-01-06T00:00:00.000Z'),
        petId: 'pet-789',
        holderId: 'user-456',
        escrowId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        pet: {
          id: 'pet-789',
          name: 'Max',
          species: 'CAT',
          breed: null,
          age: 2,
          description: null,
          imageUrl: null,
        },
      };

      mockCustodyService.createCustody.mockResolvedValue(mockResponse);

      await controller.createCustody(user, createDto);

      expect(service.createCustody).toHaveBeenCalledWith('user-456', createDto);
    });
  });
});
