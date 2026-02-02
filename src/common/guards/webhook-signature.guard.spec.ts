import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import * as crypto from 'crypto';

describe('WebhookSignatureGuard', () => {
  const webhookSecret = 'test_secret_key_123';
  let guard: WebhookSignatureGuard;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockReturnValue(webhookSecret),
    } as any;

    guard = new WebhookSignatureGuard(mockConfigService);
  });

  function createMockContext(body: any, signature?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            ...(signature !== undefined
              ? { 'x-webhook-signature': signature }
              : {}),
          },
          body,
        }),
      }),
    } as any;
  }

  function computeSignature(body: any): string {
    return crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(body))
      .digest('hex');
  }

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw if WEBHOOK_SECRET is not configured', () => {
    const emptyConfig = { get: jest.fn().mockReturnValue(undefined) } as any;

    expect(() => new WebhookSignatureGuard(emptyConfig)).toThrow(
      'WEBHOOK_SECRET must be configured',
    );
  });

  describe('valid signatures', () => {
    it('should allow request with valid HMAC SHA256 signature', () => {
      const body = { externalPaymentId: 'pay_123', amount: 999 };
      const signature = computeSignature(body);
      const context = createMockContext(body, signature);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should verify against the raw JSON body', () => {
      const body = { key: 'value', nested: { a: 1 } };
      const signature = computeSignature(body);
      const context = createMockContext(body, signature);

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('missing signature', () => {
    it('should throw UnauthorizedException when signature header is missing', () => {
      const body = { test: 'data' };
      const context = createMockContext(body); // no signature

      expect(() => guard.canActivate(context)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('invalid signatures', () => {
    it('should throw UnauthorizedException for incorrect signature', () => {
      const body = { test: 'data' };
      const context = createMockContext(body, 'invalid_signature_hex');

      expect(() => guard.canActivate(context)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for tampered body', () => {
      const originalBody = { amount: 999 };
      const tamperedBody = { amount: 1 };
      const signature = computeSignature(originalBody);
      const context = createMockContext(tamperedBody, signature);

      expect(() => guard.canActivate(context)).toThrow(
        UnauthorizedException,
      );
    });

    it('should reject signature with different length (timing-safe)', () => {
      const body = { test: 'data' };
      const context = createMockContext(body, 'short');

      expect(() => guard.canActivate(context)).toThrow(
        UnauthorizedException,
      );
    });
  });
});
