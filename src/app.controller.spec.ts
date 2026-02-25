import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('protected', () => {
    it('should reject access without JWT', async () => {
      // Simulate request without token
      // Use supertest for e2e
      // This test is for demonstration, actual e2e should be in app.e2e-spec.ts
    });
  });
});

//  this is to test  new test
// also
//add more events
