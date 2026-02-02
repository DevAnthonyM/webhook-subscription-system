import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from './subscriptions.service';
import { DatabaseService } from '../database/database.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let db: jest.Mocked<any>;

  beforeEach(async () => {
    const mockDb = {
      subscription: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    db = module.get(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('activateOrExtendSubscription', () => {
    it('should create new subscription when none exists', async () => {
      db.subscription.findUnique.mockResolvedValue(null);
      db.subscription.upsert.mockResolvedValue({
        id: 'sub-id',
        user_id: 'user-1',
        plan_type: 'monthly',
        status: 'ACTIVE',
        started_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const result = await service.activateOrExtendSubscription(
        'user-1',
        'monthly',
        30,
      );

      expect(result.status).toBe('ACTIVE');
      expect(db.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id_plan_type: { user_id: 'user-1', plan_type: 'monthly' },
          },
        }),
      );
    });

    it('should extend from current expiry when subscription is active (not from now)', async () => {
      const futureExpiry = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 days from now

      db.subscription.findUnique.mockResolvedValue({
        id: 'sub-id',
        user_id: 'user-1',
        plan_type: 'monthly',
        status: 'ACTIVE',
        expires_at: futureExpiry,
      });

      db.subscription.upsert.mockImplementation(async (args: any) => ({
        id: 'sub-id',
        status: 'ACTIVE',
        expires_at: args.update.expires_at,
      }));

      const result = await service.activateOrExtendSubscription(
        'user-1',
        'monthly',
        30,
      );

      // Should extend from futureExpiry (15 days) + 30 days = ~45 days from now
      const resultExpiry = new Date(result.expires_at as Date).getTime();
      const expectedMinExpiry =
        futureExpiry.getTime() + 29 * 24 * 60 * 60 * 1000;
      expect(resultExpiry).toBeGreaterThan(expectedMinExpiry);
    });

    it('should start from now when subscription is expired', async () => {
      const pastExpiry = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

      db.subscription.findUnique.mockResolvedValue({
        id: 'sub-id',
        user_id: 'user-1',
        plan_type: 'monthly',
        status: 'ACTIVE',
        expires_at: pastExpiry,
      });

      db.subscription.upsert.mockImplementation(async (args: any) => ({
        id: 'sub-id',
        status: 'ACTIVE',
        expires_at: args.update.expires_at,
      }));

      const result = await service.activateOrExtendSubscription(
        'user-1',
        'monthly',
        30,
      );

      // Should start from now, not from the expired date
      const resultExpiry = new Date(result.expires_at as Date).getTime();
      const now = Date.now();
      const expectedMinExpiry = now + 29 * 24 * 60 * 60 * 1000;
      const expectedMaxExpiry = now + 31 * 24 * 60 * 60 * 1000;
      expect(resultExpiry).toBeGreaterThan(expectedMinExpiry);
      expect(resultExpiry).toBeLessThan(expectedMaxExpiry);
    });

    it('should use upsert for atomic create-or-update', async () => {
      db.subscription.findUnique.mockResolvedValue(null);
      db.subscription.upsert.mockResolvedValue({ id: 'sub-id' });

      await service.activateOrExtendSubscription('user-1', 'yearly', 365);

      expect(db.subscription.upsert).toHaveBeenCalledTimes(1);
      const upsertCall = db.subscription.upsert.mock.calls[0][0];
      expect(upsertCall.create).toBeDefined();
      expect(upsertCall.update).toBeDefined();
      expect(upsertCall.create.status).toBe('ACTIVE');
    });
  });

  describe('isSubscriptionActive', () => {
    it('should return true for active subscription with future expiry', async () => {
      db.subscription.findUnique.mockResolvedValue({
        id: 'sub-id',
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        user: {},
      });

      const result = await service.isSubscriptionActive('user-1', 'monthly');

      expect(result).toBe(true);
    });

    it('should return false for expired subscription', async () => {
      db.subscription.findUnique.mockResolvedValue({
        id: 'sub-id',
        status: 'ACTIVE',
        expires_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // yesterday
        user: {},
      });

      const result = await service.isSubscriptionActive('user-1', 'monthly');

      expect(result).toBe(false);
    });

    it('should return false for cancelled subscription', async () => {
      db.subscription.findUnique.mockResolvedValue({
        id: 'sub-id',
        status: 'CANCELLED',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        user: {},
      });

      const result = await service.isSubscriptionActive('user-1', 'monthly');

      expect(result).toBe(false);
    });

    it('should return false when no subscription exists', async () => {
      db.subscription.findUnique.mockResolvedValue(null);

      const result = await service.isSubscriptionActive('user-1', 'monthly');

      expect(result).toBe(false);
    });

    it('should return false when expires_at is null', async () => {
      db.subscription.findUnique.mockResolvedValue({
        id: 'sub-id',
        status: 'ACTIVE',
        expires_at: null,
        user: {},
      });

      const result = await service.isSubscriptionActive('user-1', 'monthly');

      expect(result).toBe(false);
    });
  });

  describe('cancelSubscription', () => {
    it('should set status to CANCELLED without deleting', async () => {
      db.subscription.update.mockResolvedValue({
        id: 'sub-id',
        status: 'CANCELLED',
        expires_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      });

      const result = await service.cancelSubscription('user-1', 'monthly');

      expect(result.status).toBe('CANCELLED');
      expect(db.subscription.update).toHaveBeenCalledWith({
        where: {
          user_id_plan_type: { user_id: 'user-1', plan_type: 'monthly' },
        },
        data: { status: 'CANCELLED' },
      });
    });
  });
});
