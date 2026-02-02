import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';
import { WebhookSignatureGuard } from '../common/guards/webhook-signature.guard';
import { IWebhookResponse } from './interfaces/webhook.interface';

/**
 * Webhooks Controller
 *
 * Receives payment webhooks from payment provider
 *
 * CRITICAL REQUIREMENTS:
 * 1. ALWAYS return 200 OK (even for errors) to prevent infinite retries
 * 2. Verify webhook signature BEFORE processing (security)
 * 3. Must be fast (<5 seconds response time)
 * 4. Comprehensive logging for debugging
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * POST /webhooks/payment
   *
   * Receives payment webhooks from payment provider
   *
   * CRITICAL: Always returns 200 OK
   * - Even for duplicates (idempotency)
   * - Even for errors (prevents retry storms)
   *
   * Security: Signature verified by guard BEFORE this runs
   */
  @Post('payment')
  @HttpCode(HttpStatus.OK) // ALWAYS return 200, even for duplicates/errors
  @UseGuards(WebhookSignatureGuard) // Verify signature FIRST
  async handlePaymentWebhook(
    @Body() payload: WebhookPayloadDto,
  ): Promise<IWebhookResponse> {
    this.logger.log(
      `Webhook received: ${payload.externalPaymentId} (${payload.eventType})`,
    );

    try {
      const result = await this.webhooksService.processWebhook(payload);

      if (result.isDuplicate) {
        this.logger.log(
          `Duplicate webhook processed: ${payload.externalPaymentId}`,
        );
        return {
          status: HttpStatus.OK,
          message: 'Webhook already processed (duplicate)',
          webhookEventId: result.paymentId,
        };
      }

      this.logger.log(
        `Webhook processed successfully: ${payload.externalPaymentId}`,
      );
      return {
        status: HttpStatus.OK,
        message: 'Webhook processed successfully',
        paymentId: result.paymentId,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Webhook processing failed', {
        error: errorMessage,
        externalPaymentId: payload.externalPaymentId,
        payload,
      });

      // CRITICAL: Still return 200 to prevent payment provider retries
      // Store error in webhook_events table for investigation
      return {
        status: HttpStatus.OK,
        message: 'Webhook received, processing failed (will retry internally)',
      };
    }
  }

  /**
   * Health check endpoint
   *
   * Used to verify webhook endpoint is accessible
   */
  @Post('health')
  @HttpCode(HttpStatus.OK)
  healthCheck(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
