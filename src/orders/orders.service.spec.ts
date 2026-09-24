import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { OrdersService } from './orders.service';
import { Order } from './schemas/order.schema';
import { TradeAccount } from '../accounts/schemas/account.schema';
import { Rooftop } from '../rooftops/schemas/rooftop.schema';
import { Part } from '../parts/schemas/part.schema';
import { AuditEvent } from '../auth/schemas/audit-event.schema';
import { AccountsService } from '../accounts/accounts.service';
import { Role } from '../common/enums/roles.enum';
import { OrderState } from './enums/order-state.enum';
import { OrderLineState } from './enums/order-line-state.enum';
import { LineExceptionReason } from './enums/line-exception-reason.enum';
import { SourceKind } from '../parts/schemas/part-source.schema';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderModelMock: any;
  let accountModelMock: any;
  let rooftopModelMock: any;
  let partModelMock: any;
  let auditModelMock: any;
  let accountsServiceMock: any;

  const mockUser: any = {
    _id: '507f1f77bcf86cd799439011',
    supabaseId: 'sub-user-123',
    email: 'trade@example.com',
    fullName: 'Dave Workshop',
    role: Role.TRADE_PARTNER,
    tradeAccountId: 'ACC-000123',
    rooftopId: 'ROOFTOP-DANDENONG',
    isActive: true,
  };

  const mockStaffUser: any = {
    _id: '507f1f77bcf86cd799439012',
    supabaseId: 'sub-staff-456',
    email: 'controller@booran.com.au',
    fullName: 'Sarah Controller',
    role: Role.PARTS_CONTROLLER,
    rooftopId: 'ROOFTOP-DANDENONG',
    isActive: true,
  };

  beforeEach(async () => {
    orderModelMock = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
    };

    accountModelMock = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };

    rooftopModelMock = {
      findOne: jest.fn(),
    };

    partModelMock = {
      findOne: jest.fn(),
    };

    auditModelMock = {
      create: jest.fn(),
    };

    accountsServiceMock = {
      assertNotOnCreditHold: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: orderModelMock },
        {
          provide: getModelToken(TradeAccount.name),
          useValue: accountModelMock,
        },
        { provide: getModelToken(Rooftop.name), useValue: rooftopModelMock },
        { provide: getModelToken(Part.name), useValue: partModelMock },
        { provide: getModelToken(AuditEvent.name), useValue: auditModelMock },
        { provide: AccountsService, useValue: accountsServiceMock },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitOrder', () => {
    it('should successfully submit order and increment account spend', async () => {
      accountModelMock.findOne.mockResolvedValue({
        accountId: 'ACC-000123',
        companyName: 'Dave Auto Repairs',
        discountPercent: 15,
        creditHold: false,
        contactName: 'Dave',
      });

      rooftopModelMock.findOne.mockResolvedValue({
        rooftopId: 'ROOFTOP-DANDENONG',
        name: 'Dandenong',
        address: '100 Lonsdale St',
        oemBrandCodes: ['TOYOTA'],
      });

      partModelMock.findOne.mockResolvedValue({
        partNumber: '04465-0D060',
        partNumberNormalised: '044650D060',
        brandCode: 'TOYOTA',
        description: 'Brake Pads',
        listPriceCents: 10000,
        coreChargeCents: 0,
      });

      const mockCreatedOrder = {
        _id: 'ord-mongo-id',
        orderNumber: 'ORD-20260924-A1B2',
        totalCents: 9350,
      };

      orderModelMock.create.mockResolvedValue(mockCreatedOrder);
      accountModelMock.updateOne.mockResolvedValue({ modifiedCount: 1 });
      auditModelMock.create.mockResolvedValue({});

      const result = await service.submitOrder(
        {
          rooftopId: 'ROOFTOP-DANDENONG',
          lines: [
            {
              partNumber: '04465-0D060',
              quantity: 1,
            },
          ],
        },
        mockUser,
      );

      expect(accountsServiceMock.assertNotOnCreditHold).toHaveBeenCalledWith(
        mockUser,
      );
      expect(orderModelMock.create).toHaveBeenCalled();
      expect(accountModelMock.updateOne).toHaveBeenCalledWith(
        { accountId: 'ACC-000123' },
        expect.objectContaining({
          $inc: { ytdSpendCents: expect.any(Number), ytdOrderCount: 1 },
        }),
      );
      expect(result).toEqual(mockCreatedOrder);
    });
  });

  describe('findAll', () => {
    it('should scope queries to tradeAccountId for trade partners', async () => {
      orderModelMock.countDocuments.mockResolvedValue(1);
      orderModelMock.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([{ orderNumber: 'ORD-001' }]),
            }),
          }),
        }),
      });

      const res = await service.findAll({ limit: 10, page: 1 }, mockUser);
      expect(orderModelMock.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ tradeAccountId: 'ACC-000123' }),
      );
      expect(res.orders).toHaveLength(1);
    });
  });

  describe('pickLine', () => {
    it('should mark line as PICKED and advance order to PICKED when all lines complete', async () => {
      const mockOrder: any = {
        _id: 'ord-123',
        orderNumber: 'ORD-123',
        state: OrderState.PROCESSING,
        totalLines: 1,
        pickedLinesCount: 0,
        tradeAccountId: 'ACC-000123',
        rooftopId: 'ROOFTOP-DANDENONG',
        lines: [
          {
            lineId: 'LIN-01',
            partNumber: '04465-0D060',
            quantity: 2,
            state: OrderLineState.PENDING,
          },
        ],
        statusHistory: [],
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      orderModelMock.findOne.mockResolvedValue(mockOrder);
      auditModelMock.create.mockResolvedValue({});

      const updated = await service.pickLine(
        'ORD-123',
        'LIN-01',
        { pickedQuantity: 2 },
        mockStaffUser,
      );

      expect(mockOrder.lines[0].state).toBe(OrderLineState.PICKED);
      expect(mockOrder.state).toBe(OrderState.PICKED);
      expect(mockOrder.save).toHaveBeenCalled();
    });
  });

  describe('raiseLineException and reSourceLine', () => {
    it('should set line state to EXCEPTION and order state to EXCEPTION', async () => {
      const mockOrder: any = {
        _id: 'ord-123',
        orderNumber: 'ORD-123',
        state: OrderState.PROCESSING,
        hasExceptions: false,
        tradeAccountId: 'ACC-000123',
        rooftopId: 'ROOFTOP-DANDENONG',
        lines: [
          {
            lineId: 'LIN-01',
            partNumber: '04465-0D060',
            quantity: 2,
            state: OrderLineState.PENDING,
          },
        ],
        statusHistory: [],
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      orderModelMock.findOne.mockResolvedValue(mockOrder);
      auditModelMock.create.mockResolvedValue({});

      await service.raiseLineException(
        'ORD-123',
        'LIN-01',
        {
          reason: LineExceptionReason.OUT_OF_STOCK,
          description: 'Bin empty',
        },
        mockStaffUser,
      );

      expect(mockOrder.lines[0].state).toBe(OrderLineState.EXCEPTION);
      expect(mockOrder.hasExceptions).toBe(true);
      expect(mockOrder.state).toBe(OrderState.EXCEPTION);
    });

    it('should re-source line and resolve exception', async () => {
      const mockOrder: any = {
        _id: 'ord-123',
        orderNumber: 'ORD-123',
        state: OrderState.EXCEPTION,
        hasExceptions: true,
        tradeAccountId: 'ACC-000123',
        rooftopId: 'ROOFTOP-DANDENONG',
        lines: [
          {
            lineId: 'LIN-01',
            partNumber: '04465-0D060',
            quantity: 2,
            unitPriceCents: 8500,
            coreChargeCents: 0,
            sourceKind: SourceKind.BRANCH,
            sourceName: 'Dandenong Parts',
            state: OrderLineState.EXCEPTION,
            exception: {
              reason: LineExceptionReason.OUT_OF_STOCK,
              description: 'Bin empty',
              resolvedAt: null,
            },
            reSourceHistory: [],
          },
        ],
        statusHistory: [],
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      orderModelMock.findOne.mockResolvedValue(mockOrder);
      auditModelMock.create.mockResolvedValue({});

      await service.reSourceLine(
        'ORD-123',
        'LIN-01',
        {
          newSourceKind: SourceKind.SISTER,
          newSourceName: 'FTG Parts',
          newSourceRooftopId: 'ROOFTOP-FTG',
          notes: 'Transferred from FTG branch',
        },
        mockStaffUser,
      );

      expect(mockOrder.lines[0].sourceKind).toBe(SourceKind.SISTER);
      expect(mockOrder.lines[0].sourceName).toBe('FTG Parts');
      expect(mockOrder.lines[0].state).toBe(OrderLineState.SOURCING);
      expect(mockOrder.lines[0].exception.resolvedAt).toBeDefined();
      expect(mockOrder.hasExceptions).toBe(false);
      expect(mockOrder.state).toBe(OrderState.PROCESSING);
    });
  });
});
