import { Test } from '@nestjs/testing';
import { NotificationProcessor } from './notification.processor';
import { EmailService } from '../../email/email.service';
import { LoggingService } from '../../logging/logging.service';

describe('NotificationProcessor', () => {
  const mockEmailService = {
    sendTransactionalEmail: jest.fn(),
  };

  const mockLoggingService = {
    log: jest.fn(),
  };

  let processor: NotificationProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationProcessor,
        { provide: EmailService, useValue: mockEmailService },
        { provide: LoggingService, useValue: mockLoggingService },
      ],
    }).compile();

    processor = moduleRef.get(NotificationProcessor);
  });

  it('sends transactional email on success', async () => {
    mockEmailService.sendTransactionalEmail.mockResolvedValue({
      messageId: 'msg-1',
    });

    await processor.process({
      id: 'job-1',
      name: 'send_transactional_email',
      queueName: 'notifications',
      data: {
        dto: {
          to: 'to@example.com',
          subject: 'Subject',
          text: 'Text',
        },
        metadata: { adoptionId: 'adopt-1' },
      },
    } as any);

    expect(mockEmailService.sendTransactionalEmail).toHaveBeenCalledWith({
      to: 'to@example.com',
      subject: 'Subject',
      text: 'Text',
    });
  });

  it('throws descriptive error and logs on failure', async () => {
    mockEmailService.sendTransactionalEmail.mockRejectedValue(
      new Error('SMTP down'),
    );
    mockLoggingService.log.mockResolvedValue(null);

    await expect(
      processor.process({
        id: 'job-2',
        name: 'send_transactional_email',
        queueName: 'notifications',
        data: {
          dto: {
            to: 'to@example.com',
            subject: 'Subject',
            text: 'Text',
          },
          metadata: { adoptionId: 'adopt-2' },
        },
      } as any),
    ).rejects.toThrow(/Notification job failed/);

    expect(mockLoggingService.log).toHaveBeenCalled();
  });
});

