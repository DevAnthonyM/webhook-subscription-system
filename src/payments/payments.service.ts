import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PaymentStatus, Prisma } from '@prisma/client';

/**
 * Payments Service
 *
 * Handles all payment-related operations
 *
 * CRITICAL: Uses unique constraint on external_payment_id
 * to prevent duplicate payments
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Create payment record (idempotent via unique constraint)
   *
   * If payment with same external_payment_id already exists,
   * returns existing payment instead of throwing error
   */
  async createPayment(data: {
    userId: string;
    externalPaymentId: string;
    amount: number;
    currency: string;
    planType: string;
    paymentMethod?: string;
    provider?: string;
    metadata?: Record<string, unknown>;
  }) {
    try {
      const payment = await this.db.payment.create({
        data: {
          user_id: data.userId,
          external_payment_id: data.externalPaymentId,
          amount: data.amount,
          currency: data.currency,
          plan_type: data.planType,
          payment_method: data.paymentMethod,
          provider: data.provider,
          status: PaymentStatus.COMPLETED,
          metadata: data.metadata as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `Payment created: ${payment.id} (${payment.external_payment_id})`,
      );
      return payment;
    } catch (error: unknown) {
      // P2002 = Prisma unique constraint violation
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        this.logger.warn(
          `Duplicate payment detected: ${data.externalPaymentId}`,
        );
        // Return existing payment instead of failing
        return await this.findByExternalId(data.externalPaymentId);
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create payment: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Find payment by external ID (from payment provider)
   *
   * Used for:
   * - Deduplication checks
   * - Looking up payment details
   * - Finding user from payment
   */
  async findByExternalId(externalPaymentId: string) {
    return this.db.payment.findUnique({
      where: { external_payment_id: externalPaymentId },
      include: {
        user: true, // Include user details
      },
    });
  }

  /**
   * Get user's payment history
   *
   * Returns payments ordered by most recent first
   */
  async getUserPayments(userId: string, limit = 20) {
    return this.db.payment.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  /**
   * Get payment statistics
   *
   * Useful for reporting and analytics
   */
  async getPaymentStats(userId: string) {
    const payments = await this.db.payment.findMany({
      where: { user_id: userId },
    });

    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    const completedPayments = payments.filter(
      (p) => p.status === PaymentStatus.COMPLETED,
    ).length;

    return {
      totalPayments: payments.length,
      completedPayments,
      totalAmount,
      averageAmount: payments.length > 0 ? totalAmount / payments.length : 0,
    };
  }
}
