import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Request } from 'express';

/**
 * Webhook Signature Guard
 *
 * SECURITY: Verifies webhook signature to prevent fake webhooks from attackers
 *
 * How it works:
 * 1. Payment provider sends webhook with signature in header
 * 2. We compute expected signature using webhook secret
 * 3. Compare signatures using timing-safe comparison
 * 4. If match → allow request, if not → reject with 401
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);
  private readonly webhookSecret: string;

  constructor(private configService: ConfigService) {
    // Get webhook secret from environment
    const secret = this.configService.get<string>('WEBHOOK_SECRET');

    if (!secret) {
      this.logger.error('WEBHOOK_SECRET not found in environment variables');
      throw new Error('WEBHOOK_SECRET must be configured');
    }

    this.webhookSecret = secret;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const signature = request.headers['x-webhook-signature'] as string;
    const rawBody = JSON.stringify(request.body);

    // Check if signature exists
    if (!signature) {
      this.logger.error('Missing webhook signature in request headers');
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Compute expected signature using HMAC SHA256
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    // Timing-safe comparison to prevent timing attacks
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );

      if (!isValid) {
        this.logger.error('Invalid webhook signature', {
          received: signature.substring(0, 10) + '...',
          expected: expectedSignature.substring(0, 10) + '...',
        });
        throw new UnauthorizedException('Invalid webhook signature');
      }

      this.logger.log('Webhook signature verified successfully');
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      // Handle buffer length mismatch (different signature lengths)
      this.logger.error(
        'Webhook signature verification failed',
        (error as Error).message,
      );
      throw new UnauthorizedException('Invalid webhook signature format');
    }
  }
}
