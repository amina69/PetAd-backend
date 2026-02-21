import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    await service.$disconnect(); // Ensure proper teardown
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should be defined as PrismaService', () => {
    expect(service.constructor.name).toBe('PrismaService');
  });

  it('should have onModuleInit method', () => {
    expect(typeof service.onModuleInit).toBe('function');
  });

  it('should have onModuleDestroy method', () => {
    expect(typeof service.onModuleDestroy).toBe('function');
  });
});
