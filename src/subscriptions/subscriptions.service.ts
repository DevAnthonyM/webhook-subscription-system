import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SubscriptionStatus } from '@prisma/client';

/**
 * Subscriptions Service
 *
 * Handles subscription activation and extension
 *
 * CRITICAL LOGIC:
 * - New subscription: starts from now
 * - Active subscription: extends from current expiry (not from now!)
 * - Expired subscription: reactivates from now
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Activate or extend subscription
   *
   * Business Logic:
   * - If subscription is ACTIVE and NOT expired → extend from current expiry
   * - If subscription is PENDING/EXPIRED/doesn't exist → start from now
   *
   * This ensures users don't lose time when renewing early
   */
  async activateOrExtendSubscription(
    userId: string,
    planType: string,
    durationDays: number,
  ) {
    const existing = await this.db.subscription.findUnique({
      where: {
        user_id_plan_type: {
          user_id: userId,
          plan_type: planType,
        },
      },
    });

    const now = new Date();
    let newExpiryDate: Date;

    if (
      existing &&
      existing.status === SubscriptionStatus.ACTIVE &&
      existing.expires_at &&
      existing.expires_at > now
    ) {
      // Subscription is active and not expired
      // Extend from current expiry (user keeps their remaining time!)
      newExpiryDate = new Date(existing.expires_at);
      newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);

      this.logger.log(
        `Extending subscription ${existing.id} from ${existing.expires_at.toISOString()} to ${newExpiryDate.toISOString()}`,
      );
    } else {
      // New subscription OR expired subscription
      // Start from now
      newExpiryDate = new Date(now);
      newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);

      this.logger.log(
        `Activating subscription for user ${userId}, expires ${newExpiryDate.toISOString()}`,
      );
    }

    // Upsert: create if doesn't exist, update if exists
    const subscription = await this.db.subscription.upsert({
      where: {
        user_id_plan_type: {
          user_id: userId,
          plan_type: planType,
        },
      },
      create: {
        user_id: userId,
        plan_type: planType,
        status: SubscriptionStatus.ACTIVE,
        started_at: now,
        expires_at: newExpiryDate,
      },
      update: {
        status: SubscriptionStatus.ACTIVE,
        expires_at: newExpiryDate,
        updated_at: now,
      },
    });

    return subscription;
  }

  /**
   * Get user's subscription
   */
  async getUserSubscription(userId: string, planType: string) {
    return this.db.subscription.findUnique({
      where: {
        user_id_plan_type: {
          user_id: userId,
          plan_type: planType,
        },
      },
      include: {
        user: true,
      },
    });
  }

  /**
   * Check if subscription is active
   *
   * Returns true only if:
   * - Subscription exists
   * - Status is ACTIVE
   * - Not expired (expires_at > now)
   */
  async isSubscriptionActive(
    userId: string,
    planType: string,
  ): Promise<boolean> {
    const subscription = await this.getUserSubscription(userId, planType);

    if (!subscription) return false;
    if (subscription.status !== SubscriptionStatus.ACTIVE) return false;
    if (!subscription.expires_at) return false;
    if (subscription.expires_at < new Date()) return false;

    return true;
  }

  /**
   * Get all active subscriptions for a user
   */
  async getUserActiveSubscriptions(userId: string) {
    return this.db.subscription.findMany({
      where: {
        user_id: userId,
        status: SubscriptionStatus.ACTIVE,
        expires_at: {
          gt: new Date(), // Greater than now (not expired)
        },
      },
    });
  }

  /**
   * Cancel subscription
   *
   * Note: Doesn't delete, just marks as CANCELLED
   * User retains access until expires_at
   */
  async cancelSubscription(userId: string, planType: string) {
    const subscription = await this.db.subscription.update({
      where: {
        user_id_plan_type: {
          user_id: userId,
          plan_type: planType,
        },
      },
      data: {
        status: SubscriptionStatus.CANCELLED,
      },
    });

    this.logger.log(
      `Subscription cancelled: ${subscription.id} (expires ${subscription.expires_at?.toISOString()})`,
    );

    return subscription;
  }
}
