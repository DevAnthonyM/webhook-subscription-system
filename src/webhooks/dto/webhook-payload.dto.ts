import {
  IsString,
  IsNumber,
  IsEmail,
  IsOptional,
  IsNotEmpty,
  Min,
} from 'class-validator';

/**
 * Webhook Payload DTO - Validates incoming webhook data
 *
 * CRITICAL FIELDS:
 * - externalPaymentId: Idempotency key (prevents duplicate payments)
 * - amount: In cents (e.g., $10.00 = 1000)
 * - email: Optional (edge case: webhook arrives without email)
 */
export class WebhookPayloadDto {
  @IsString()
  @IsNotEmpty()
  externalPaymentId: string; // CRITICAL: Idempotency key from payment provider

  @IsString()
  @IsNotEmpty()
  eventType: string; // e.g., "payment.success", "payment.failed"

  @IsEmail()
  @IsOptional() // Edge case: webhook might come without email
  email?: string;

  @IsNumber()
  @Min(0)
  amount: number; // In cents (e.g., $10.00 = 1000)

  @IsString()
  @IsNotEmpty()
  currency: string; // e.g., "USD", "EUR", "KES"

  @IsString()
  @IsNotEmpty()
  planType: string; // e.g., "monthly", "yearly", "lifetime"

  @IsString()
  @IsOptional()
  paymentMethod?: string; // e.g., "card", "mobile_money", "bank_transfer"

  @IsString()
  @IsOptional()
  provider?: string; // e.g., "stripe", "paystack", "flutterwave"

  @IsOptional()
  metadata?: any; // Additional payment data from provider
}
