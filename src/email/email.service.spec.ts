import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import nodemailer from 'nodemailer';
import { EmailService } from './email.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

describe('EmailService', () => {
  let service: EmailService;
  const sendMailMock = jest.fn();

  const configValues: Record<string, string | number | undefined> = {
    SMTP_HOST: 'smtp.test.local',
    SMTP_PORT: 587,
    SMTP_USER: 'smtp-user',
    SMTP_PASS: 'smtp-pass',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'PetAd <no-reply@test.local>',
  };

  const mockConfigService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    sendMailMock.mockReset();

    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: sendMailMock,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should send a transactional email successfully', async () => {
    sendMailMock.mockResolvedValue({
      messageId: 'message-123',
      accepted: ['adopter@example.com'],
      rejected: [],
    });

    const response = await service.sendTransactionalEmail({
      to: 'adopter@example.com',
      subject: 'Adoption Update',
      text: 'Your request has been approved',
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      message: 'Email sent successfully',
      messageId: 'message-123',
      accepted: ['adopter@example.com'],
      rejected: [],
    });
  });

  it('should throw a descriptive error when provider rejects send', async () => {
    sendMailMock.mockResolvedValue({
      messageId: 'message-123',
      accepted: [],
      rejected: ['adopter@example.com'],
    });

    await expect(
      service.sendTransactionalEmail({
        to: 'adopter@example.com',
        subject: 'Adoption Update',
        text: 'Your request has been approved',
      }),
    ).rejects.toThrow(
      new InternalServerErrorException(
        'Email provider did not accept the message',
      ),
    );
  });

  it('should throw a descriptive error when transport fails', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP timeout'));

    await expect(
      service.sendTransactionalEmail({
        to: 'owner@example.com',
        subject: 'New adoption request',
        text: 'A new adoption request was submitted for your pet',
      }),
    ).rejects.toThrow(
      new InternalServerErrorException(
        'Failed to send email to owner@example.com: SMTP timeout',
      ),
    );
  });
});
