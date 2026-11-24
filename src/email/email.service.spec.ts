import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import nodemailer from 'nodemailer';
import { EmailService } from './email.service';
import { EmailTemplateService } from './template.service';
import { PermanentEmailError, TransientEmailError } from './email.errors';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

interface SentMail {
  html?: string;
  text?: string;
  headers?: Record<string, string>;
}

describe('EmailService', () => {
  let service: EmailService;
  const sentMail = (index = 0): SentMail =>
    (sendMailMock.mock.calls as unknown as Array<[SentMail]>)[index][0];
  const sendMailMock = jest.fn();
  const prismaMock = {
    emailSuppression: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const configValues: Record<string, string | number | undefined> = {
    SMTP_HOST: 'smtp.test.local',
    SMTP_PORT: 587,
    SMTP_USER: 'smtp-user',
    SMTP_PASS: 'smtp-pass',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'PetAd <no-reply@test.local>',
    EMAIL_RATE_LIMIT_PER_MINUTE: 20,
  };

  const mockConfigService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    sendMailMock.mockReset();
    prismaMock.emailSuppression.findUnique.mockResolvedValue(null);
    prismaMock.emailSuppression.upsert.mockResolvedValue({});

    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: sendMailMock,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        EmailTemplateService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PrismaService,
          useValue: prismaMock,
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

  it('treats a provider rejection as a permanent (non-retryable) error', async () => {
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
    ).rejects.toBeInstanceOf(PermanentEmailError);
  });

  it('treats a transport failure as retryable', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP timeout'));

    await expect(
      service.sendTransactionalEmail({
        to: 'owner@example.com',
        subject: 'New adoption request',
        text: 'A new adoption request was submitted for your pet',
      }),
    ).rejects.toThrow(
      new TransientEmailError(
        'Failed to send email to owner@example.com: SMTP timeout',
      ),
    );
  });

  it('escapes HTML supplied through template variables', async () => {
    sendMailMock.mockResolvedValue({
      messageId: 'message-html',
      accepted: ['adopter@example.com'],
      rejected: [],
    });

    await service.sendTransactionalEmail({
      to: 'adopter@example.com',
      subject: 'Hello',
      template: 'notification',
      context: {
        heading: '<script>alert(1)</script>',
        message: '<img src=x onerror=alert(1)>',
      },
    });

    const mail = sentMail();
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.text).toContain('<img src=x onerror=alert(1)>');
  });

  it('skips and logs a suppressed address', async () => {
    prismaMock.emailSuppression.findUnique.mockResolvedValue({
      email: 'bounced@example.com',
      reason: 'HARD_BOUNCE',
    });

    const result = await service.sendTransactionalEmail({
      to: 'bounced@example.com',
      subject: 'Update',
      text: 'Hello',
    });

    expect(result.skipped).toBe(true);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('adds List-Unsubscribe headers to non-essential mail only', async () => {
    sendMailMock.mockResolvedValue({
      messageId: 'message-marketing',
      accepted: ['user@example.com'],
      rejected: [],
    });

    await service.sendTransactionalEmail({
      to: 'user@example.com',
      subject: 'News',
      text: 'Hello',
      category: 'marketing',
    });

    const marketingMail = sentMail();
    expect(marketingMail.headers?.['List-Unsubscribe']).toContain('mailto:');
    expect(marketingMail.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );

    await service.sendTransactionalEmail({
      to: 'user@example.com',
      subject: 'Security',
      text: 'Hello',
      category: 'essential',
    });

    expect(sentMail(1).headers).toBeUndefined();
  });
});
