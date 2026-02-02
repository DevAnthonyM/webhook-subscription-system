import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as crypto from 'crypto';
import { ConfigModule } from '@nestjs/config';
import { WebhooksModule } from '../src/webhooks/webhooks.module';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { PaymentsModule } from '../src/payments/payments.module';
import { SubscriptionsModule } from '../src/subscriptions/subscriptions.module';

const WEBHOOK_SECRET = 'e2e_test_secret';

function signPayload(body: any): string {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

describe('Webhooks E2E', () => {
  let app: INestApplication<App>;
  let mockDb: any;

  beforeAll(async () => {
    mockDb = {
      webhookEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      payment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(),
      $connect: jest.fn(),
      $disconnect: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              WEBHOOK_SECRET,
              PORT: 3000,
              NODE_ENV: 'test',
            }),
          ],
        }),
        DatabaseModule,
        WebhooksModule,
        PaymentsModule,
        SubscriptionsModule,
      ],
    })
      .overrideProvider(DatabaseService)
      .useValue(mockDb)
      .compile();

    app = moduleFixture.createNestApplication();
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validPayload = {
    externalPaymentId: 'pay_e2e_001',
    eventType: 'payment.success',
    email: 'e2e@example.com',
    amount: 999,
    currency: 'USD',
    planType: 'monthly',
  };

  // =============================================
  // RUBRIC: Signature verification (security)
  // =============================================
  describe('POST /webhooks/payment - Signature verification', () => {
    it('should reject request with no signature header', async () => {
      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .send(validPayload);

      expect(response.status).toBe(401);
    });

    it('should reject request with invalid signature', async () => {
      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', 'invalid_signature')
        .send(validPayload);

      expect(response.status).toBe(401);
    });

    it('should accept request with valid HMAC SHA256 signature', async () => {
      mockDb.webhookEvent.findUnique.mockResolvedValue(null);
      mockDb.webhookEvent.create.mockResolvedValue({
        id: 'event-id',
        status: 'RECEIVED',
      });
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'e2e@example.com',
      });
      mockDb.$transaction.mockImplementation(async (fn: any) =>
        fn({
          payment: {
            create: jest.fn().mockResolvedValue({ id: 'pay-id' }),
          },
          subscription: {
            upsert: jest.fn().mockResolvedValue({ id: 'sub-id' }),
          },
          webhookEvent: { update: jest.fn() },
        }),
      );

      const signature = signPayload(validPayload);

      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('processed successfully');
    });
  });

  // =============================================
  // RUBRIC: Successful webhook processing
  // =============================================
  describe('POST /webhooks/payment - Successful processing', () => {
    it('should return 200 with success message', async () => {
      mockDb.webhookEvent.findUnique.mockResolvedValue(null);
      mockDb.webhookEvent.create.mockResolvedValue({
        id: 'event-id',
        status: 'RECEIVED',
      });
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'e2e@example.com',
      });
      mockDb.$transaction.mockImplementation(async (fn: any) =>
        fn({
          payment: {
            create: jest.fn().mockResolvedValue({ id: 'pay-id' }),
          },
          subscription: {
            upsert: jest.fn().mockResolvedValue({ id: 'sub-id' }),
          },
          webhookEvent: { update: jest.fn() },
        }),
      );

      const signature = signPayload(validPayload);

      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe(200);
      expect(response.body.paymentId).toBe('pay-id');
    });
  });

  // =============================================
  // RUBRIC: Idempotency - duplicate returns 200
  // =============================================
  describe('POST /webhooks/payment - Duplicate handling', () => {
    it('should return 200 for duplicate webhook (not error)', async () => {
      mockDb.webhookEvent.findUnique.mockResolvedValue({
        id: 'existing-event',
        status: 'PROCESSED',
        processed_at: new Date(),
      });

      const signature = signPayload(validPayload);

      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('duplicate');
    });

    it('should not start a transaction for duplicate webhook', async () => {
      mockDb.webhookEvent.findUnique.mockResolvedValue({
        id: 'existing-event',
        status: 'PROCESSED',
        processed_at: new Date(),
      });

      const signature = signPayload(validPayload);

      await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(validPayload);

      expect(mockDb.$transaction).not.toHaveBeenCalled();
    });
  });

  // =============================================
  // RUBRIC: Input validation (DTO)
  // =============================================
  describe('POST /webhooks/payment - Payload validation', () => {
    it('should reject payload missing required externalPaymentId', async () => {
      const invalid = { ...validPayload } as any;
      delete invalid.externalPaymentId;
      const signature = signPayload(invalid);

      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(invalid);

      expect(response.status).toBe(400);
    });

    it('should reject payload missing required eventType', async () => {
      const invalid = { ...validPayload } as any;
      delete invalid.eventType;
      const signature = signPayload(invalid);

      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(invalid);

      expect(response.status).toBe(400);
    });

    it('should reject payload with negative amount', async () => {
      const invalid = { ...validPayload, amount: -100 };
      const signature = signPayload(invalid);

      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(invalid);

      expect(response.status).toBe(400);
    });

    it('should reject payload with invalid email format', async () => {
      const invalid = { ...validPayload, email: 'not-an-email' };
      const signature = signPayload(invalid);

      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(invalid);

      expect(response.status).toBe(400);
    });

    it('should accept payload without optional email', async () => {
      const noEmail = { ...validPayload } as any;
      delete noEmail.email;

      mockDb.webhookEvent.findUnique.mockResolvedValue(null);
      mockDb.webhookEvent.create.mockResolvedValue({
        id: 'event-id',
        status: 'RECEIVED',
      });
      mockDb.user.findUnique.mockResolvedValue(null);
      mockDb.user.create.mockResolvedValue({
        id: 'anon-user',
        email: 'user-placeholder@pending.com',
      });
      mockDb.$transaction.mockImplementation(async (fn: any) =>
        fn({
          payment: {
            create: jest.fn().mockResolvedValue({ id: 'pay-id' }),
          },
          subscription: {
            upsert: jest.fn().mockResolvedValue({ id: 'sub-id' }),
          },
          webhookEvent: { update: jest.fn() },
        }),
      );

      const signature = signPayload(noEmail);

      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(noEmail);

      expect(response.status).toBe(200);
    });

    it('should reject unknown/extra properties (forbidNonWhitelisted)', async () => {
      const withExtra = { ...validPayload, maliciousField: 'hacked' };
      const signature = signPayload(withExtra);

      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(withExtra);

      expect(response.status).toBe(400);
    });
  });

  // =============================================
  // RUBRIC: Error handling - always return 200
  // =============================================
  describe('POST /webhooks/payment - Error resilience', () => {
    it('should return 200 even when processing fails internally', async () => {
      mockDb.webhookEvent.findUnique.mockResolvedValue(null);
      mockDb.webhookEvent.create.mockResolvedValue({
        id: 'event-id',
        status: 'RECEIVED',
      });
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'e2e@example.com',
      });
      mockDb.$transaction.mockRejectedValue(
        new Error('Database connection lost'),
      );

      const signature = signPayload(validPayload);

      const response = await request(app.getHttpServer())
        .post('/webhooks/payment')
        .set('x-webhook-signature', signature)
        .send(validPayload);

      // Controller catches errors and still returns 200
      expect(response.status).toBe(200);
      expect(response.body.message).toContain('failed');
    });
  });

  // =============================================
  // Health check endpoint
  // =============================================
  describe('POST /webhooks/health', () => {
    it('should return 200 with status ok', async () => {
      const response = await request(app.getHttpServer())
        .post('/webhooks/health')
        .send();

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
    });
  });
});
