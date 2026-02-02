import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { DatabaseService } from '../database/database.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let db: jest.Mocked<any>;

  beforeEach(async () => {
    const mockDb = {
      payment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    db = module.get(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPayment', () => {
    const paymentData = {
      userId: 'user-123',
      externalPaymentId: 'ext_pay_456',
      amount: 999,
      currency: 'USD',
      planType: 'monthly',
    };

    it('should create a new payment successfully', async () => {
      const mockPayment = {
        id: 'payment-id',
        external_payment_id: 'ext_pay_456',
        status: 'COMPLETED',
      };

      db.payment.create.mockResolvedValue(mockPayment);

      const result = await service.createPayment(paymentData);

      expect(result).toEqual(mockPayment);
      expect(db.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          external_payment_id: 'ext_pay_456',
          status: 'COMPLETED',
          amount: 999,
        }),
      });
    });

    it('should return existing payment on duplicate external_payment_id (P2002)', async () => {
      const prismaError = new Error('Unique constraint failed');
      (prismaError as any).code = 'P2002';

      db.payment.create.mockRejectedValue(prismaError);
      db.payment.findUnique.mockResolvedValue({
        id: 'existing-payment-id',
        external_payment_id: 'ext_pay_456',
        status: 'COMPLETED',
      });

      const result = await service.createPayment(paymentData);

      expect(result).toEqual(
        expect.objectContaining({ id: 'existing-payment-id' }),
      );
      expect(db.payment.findUnique).toHaveBeenCalledWith({
        where: { external_payment_id: 'ext_pay_456' },
        include: { user: true },
      });
    });

    it('should rethrow non-P2002 errors', async () => {
      db.payment.create.mockRejectedValue(new Error('Connection lost'));

      await expect(service.createPayment(paymentData)).rejects.toThrow(
        'Connection lost',
      );
    });
  });

  describe('findByExternalId', () => {
    it('should find payment by external_payment_id', async () => {
      const mockPayment = {
        id: 'pay-id',
        external_payment_id: 'ext_123',
        user: { id: 'user-id', email: 'test@example.com' },
      };

      db.payment.findUnique.mockResolvedValue(mockPayment);

      const result = await service.findByExternalId('ext_123');

      expect(result).toEqual(mockPayment);
      expect(db.payment.findUnique).toHaveBeenCalledWith({
        where: { external_payment_id: 'ext_123' },
        include: { user: true },
      });
    });

    it('should return null for non-existent external_payment_id', async () => {
      db.payment.findUnique.mockResolvedValue(null);

      const result = await service.findByExternalId('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getUserPayments', () => {
    it('should return payments ordered by created_at desc', async () => {
      db.payment.findMany.mockResolvedValue([
        { id: 'pay-2', created_at: new Date('2026-02-02') },
        { id: 'pay-1', created_at: new Date('2026-01-01') },
      ]);

      const result = await service.getUserPayments('user-id');

      expect(result).toHaveLength(2);
      expect(db.payment.findMany).toHaveBeenCalledWith({
        where: { user_id: 'user-id' },
        orderBy: { created_at: 'desc' },
        take: 20,
      });
    });
  });
});
