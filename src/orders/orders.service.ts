import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument, OrderLine } from './schemas/order.schema';
import { TradeAccount, TradeAccountDocument } from '../accounts/schemas/account.schema';
import { Rooftop, RooftopDocument } from '../rooftops/schemas/rooftop.schema';
import { Part, PartDocument } from '../parts/schemas/part.schema';
import {
  AuditEvent,
  AuditEventDocument,
  AuditAction,
} from '../auth/schemas/audit-event.schema';
import { AccountsService } from '../accounts/accounts.service';
import { UserDocument } from '../auth/schemas/user.schema';
import { Role } from '../common/enums/roles.enum';
import { OrderState } from './enums/order-state.enum';
import { OrderLineState } from './enums/order-line-state.enum';
import { DeliveryMethod } from './enums/delivery-method.enum';
import { SourceKind } from '../parts/schemas/part-source.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { OrderQueueQueryDto } from './dto/order-queue-query.dto';
import { UpdateOrderStateDto } from './dto/update-order-state.dto';
import { RaiseLineExceptionDto } from './dto/raise-line-exception.dto';
import { ReSourceLineDto } from './dto/re-source-line.dto';
import { PickLineDto } from './dto/pick-line.dto';
import { PentanaDmsService } from '../integrations/pentana-dms.service';
import { CapricornService } from '../integrations/capricorn.service';

const STAFF_ROLES = [
  Role.PARTS_CONTROLLER,
  Role.STORE_MANAGER,
  Role.GROUP_ADMIN,
  Role.CSUITES,
];

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(TradeAccount.name)
    private accountModel: Model<TradeAccountDocument>,
    @InjectModel(Rooftop.name) private rooftopModel: Model<RooftopDocument>,
    @InjectModel(Part.name) private partModel: Model<PartDocument>,
    @InjectModel(AuditEvent.name)
    private auditModel: Model<AuditEventDocument>,
    private readonly accountsService: AccountsService,
    private readonly pentanaDms: PentanaDmsService,
    private readonly capricornService: CapricornService,
  ) {}

  // ─── POST /orders: SUBMIT ORDER ──────────────────────────────────────────────

  async submitOrder(
    dto: CreateOrderDto,
    user: UserDocument,
    ipAddress?: string,
  ): Promise<OrderDocument> {
    // 1. Credit hold enforcement
    await this.accountsService.assertNotOnCreditHold(user);

    // 2. Resolve Trade Account
    let tradeAccountId: string;
    if (user.role === Role.TRADE_PARTNER) {
      if (!user.tradeAccountId) {
        throw new ForbiddenException(
          'Your profile is not linked to an active trade account.',
        );
      }
      tradeAccountId = user.tradeAccountId;
    } else {
      tradeAccountId = (dto.tradeAccountId || user.tradeAccountId)!;
      if (!tradeAccountId) {
        throw new BadRequestException(
          'tradeAccountId is required when submitting an order as staff.',
        );
      }
    }

    const account = await this.accountModel.findOne({
      accountId: tradeAccountId,
      isActive: true,
    });
    if (!account) {
      throw new NotFoundException(`Trade account ${tradeAccountId} not found.`);
    }

    if (account.creditHold) {
      throw new ForbiddenException(
        'This trade account is currently on credit hold. Order submission blocked.',
      );
    }

    // Capricorn trade account validation if applicable
    if (account.paymentTerms && account.paymentTerms.toUpperCase().includes('CAPRICORN')) {
      await this.capricornService.validateMember(account.accountId);
    }

    // 3. Resolve Rooftop
    const rooftopId = dto.rooftopId || user.rooftopId || account.rooftopId;
    if (!rooftopId) {
      throw new BadRequestException(
        'rooftopId must be specified in the request or assigned to user/account.',
      );
    }

    const rooftop = await this.rooftopModel.findOne({
      rooftopId,
      isActive: true,
    });
    if (!rooftop) {
      throw new NotFoundException(`Rooftop ${rooftopId} not found or inactive.`);
    }

    // 4. Build Order Lines and calculate pricing
    const orderLines: OrderLine[] = [];
    let subtotalCents = 0;
    let coreChargeTotalCents = 0;

    for (let i = 0; i < dto.lines.length; i++) {
      const item = dto.lines[i];
      const partNumberNormalised = item.partNumber
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase();

      const part = await this.partModel.findOne({
        partNumberNormalised,
        isActive: true,
      });

      const brandCode =
        item.brandCode || part?.brandCode || rooftop.oemBrandCodes[0] || 'GENUINE';
      const description =
        item.description || part?.description || `Part ${item.partNumber}`;

      let unitPriceCents = item.unitPriceCents;
      if (unitPriceCents === undefined || unitPriceCents === null) {
        if (part?.listPriceCents) {
          const discountMultiplier = 1 - (account.discountPercent || 0) / 100;
          unitPriceCents = Math.round(part.listPriceCents * discountMultiplier);
        } else {
          unitPriceCents = 0;
        }
      }

      const coreChargeCents =
        item.coreChargeCents ?? part?.coreChargeCents ?? 0;
      const lineTotal =
        unitPriceCents * item.quantity + coreChargeCents * item.quantity;

      subtotalCents += unitPriceCents * item.quantity;
      coreChargeTotalCents += coreChargeCents * item.quantity;

      orderLines.push({
        lineId: `LIN-${String(i + 1).padStart(2, '0')}`,
        partNumber: item.partNumber,
        partNumberNormalised,
        brandCode,
        description,
        quantity: item.quantity,
        unitPriceCents,
        coreChargeCents,
        totalPriceCents: lineTotal,
        sourceKind: item.sourceKind || SourceKind.BRANCH,
        sourceName: item.sourceName || `${rooftop.name} Parts`,
        sourceRooftopId: item.sourceRooftopId || (item.sourceKind === SourceKind.BRANCH ? rooftopId : null),
        binLocation: item.binLocation || 'A-01',
        eta: item.eta || null,
        state: OrderLineState.PENDING,
        pickedQuantity: 0,
        pickedAt: null,
        pickedBy: null,
        exception: null,
        reSourceHistory: [],
      });
    }

    const gstCents = Math.round((subtotalCents + coreChargeTotalCents) * 0.1);
    const totalCents = subtotalCents + coreChargeTotalCents + gstCents;

    // 5. Generate canonical Order Number
    const orderNumber = this.generateOrderNumber();

    // 6. Connect with Pentana DMS Dispatch Queue
    const dmsResult = await this.pentanaDms.submitOrderToDms({
      orderNumber,
      tradeAccountId,
      rooftopId,
      totalCents,
      lines: orderLines.map((l) => ({
        partNumber: l.partNumber,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
      })),
    });

    // 7. Create Order Document
    const order = await this.orderModel.create({
      orderNumber,
      tradeAccountId,
      rooftopId,
      placedByUserId: user.supabaseId,
      placedByEmail: user.email,
      placedByName: user.fullName || user.email,
      customerReference: dto.customerReference ?? null,
      deliveryMethod: dto.deliveryMethod ?? DeliveryMethod.DELIVERY,
      deliveryAddress: dto.deliveryAddress ?? (account.contactName ? `${account.companyName}, ${rooftop.address}` : null),
      deliveryNotes: dto.deliveryNotes ?? null,
      state: OrderState.SUBMITTED,
      subtotalCents,
      coreChargeTotalCents,
      gstCents,
      totalCents,
      lines: orderLines,
      totalLines: orderLines.length,
      pickedLinesCount: 0,
      hasExceptions: false,
      statusHistory: [
        {
          fromState: OrderState.SUBMITTED,
          toState: OrderState.SUBMITTED,
          changedBy: user.supabaseId,
          changedAt: new Date(),
          notes: `Order placed and queued in Pentana DMS (${dmsResult.dmsOrderNumber})`,
        },
      ],
    });

    // 8. Increment Account YTD Spend & Order Count
    const currentYear = new Date().getFullYear();
    await this.accountModel.updateOne(
      { accountId: tradeAccountId },
      {
        $inc: {
          ytdSpendCents: totalCents,
          ytdOrderCount: 1,
        },
        $set: {
          ytdYear: currentYear,
        },
      },
    );

    // 9. Audit event
    await this.writeAudit(
      AuditAction.ORDER_SUBMIT,
      user.supabaseId,
      tradeAccountId,
      rooftopId,
      {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        dmsOrderNumber: dmsResult.dmsOrderNumber,
        totalCents,
        lineCount: orderLines.length,
      },
      ipAddress,
    );

    return order;
  }

  // ─── GET /orders: PARTNER ORDER HISTORY & FILTERED LIST ──────────────────────

  async findAll(
    query: QueryOrdersDto,
    user: UserDocument,
  ): Promise<{
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    orders: OrderDocument[];
  }> {
    const filter: Record<string, any> = {};

    if (user.role === Role.TRADE_PARTNER) {
      if (!user.tradeAccountId) {
        return { total: 0, page: 1, limit: query.limit || 20, totalPages: 0, orders: [] };
      }
      filter.tradeAccountId = user.tradeAccountId;
    } else if (query.tradeAccountId) {
      filter.tradeAccountId = query.tradeAccountId;
    }

    if (query.rooftopId) {
      filter.rooftopId = query.rooftopId;
    }

    if (query.state) {
      filter.state = query.state;
    }

    if (query.hasExceptions !== undefined) {
      filter.hasExceptions = query.hasExceptions;
    }

    if (query.deliveryMethod) {
      filter.deliveryMethod = query.deliveryMethod;
    }

    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) {
        filter.createdAt.$gte = new Date(query.from);
      }
      if (query.to) {
        filter.createdAt.$lte = new Date(query.to);
      }
    }

    if (query.search) {
      const searchRegex = new RegExp(query.search.trim(), 'i');
      filter.$or = [
        { orderNumber: searchRegex },
        { customerReference: searchRegex },
        { 'lines.partNumber': searchRegex },
        { 'lines.description': searchRegex },
      ];
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [total, orders] = await Promise.all([
      this.orderModel.countDocuments(filter).exec(),
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      orders: orders as OrderDocument[],
    };
  }

  // ─── GET /orders/queue: CONTROLLER FULFILLMENT QUEUE ──────────────────────────

  async getQueue(
    query: OrderQueueQueryDto,
    user: UserDocument,
  ): Promise<{
    rooftopId: string;
    summary: {
      totalQueued: number;
      pendingPicking: number;
      partiallyPicked: number;
      exceptionsCount: number;
    };
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
    orders: OrderDocument[];
  }> {
    const rooftopId =
      query.rooftopId || user.rooftopId || 'ROOFTOP-DANDENONG';

    const filter: Record<string, any> = { rooftopId };

    if (query.state) {
      filter.state = query.state;
    } else {
      filter.state = {
        $in: [
          OrderState.SUBMITTED,
          OrderState.PROCESSING,
          OrderState.PARTIALLY_PICKED,
          OrderState.PICKED,
          OrderState.READY_FOR_DELIVERY,
          OrderState.DISPATCHED,
          OrderState.EXCEPTION,
        ],
      };
    }

    if (query.hasExceptions !== undefined) {
      filter.hasExceptions = query.hasExceptions;
    }

    const [
      totalQueued,
      pendingPicking,
      partiallyPicked,
      exceptionsCount,
    ] = await Promise.all([
      this.orderModel.countDocuments({
        rooftopId,
        state: {
          $in: [
            OrderState.SUBMITTED,
            OrderState.PROCESSING,
            OrderState.PARTIALLY_PICKED,
            OrderState.PICKED,
            OrderState.READY_FOR_DELIVERY,
            OrderState.DISPATCHED,
            OrderState.EXCEPTION,
          ],
        },
      }),
      this.orderModel.countDocuments({
        rooftopId,
        state: { $in: [OrderState.SUBMITTED, OrderState.PROCESSING] },
      }),
      this.orderModel.countDocuments({
        rooftopId,
        state: OrderState.PARTIALLY_PICKED,
      }),
      this.orderModel.countDocuments({
        rooftopId,
        hasExceptions: true,
      }),
    ]);

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 25));
    const skip = (page - 1) * limit;

    const [total, orders] = await Promise.all([
      this.orderModel.countDocuments(filter),
      this.orderModel
        .find(filter)
        .sort({ hasExceptions: -1, createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
    ]);

    return {
      rooftopId,
      summary: {
        totalQueued,
        pendingPicking,
        partiallyPicked,
        exceptionsCount,
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      orders,
    };
  }

  // ─── GET /orders/:id: ORDER DETAIL + LINE STATES ──────────────────────────────

  async findOne(id: string, user: UserDocument): Promise<OrderDocument> {
    const order = await this.resolveOrder(id);

    if (
      user.role === Role.TRADE_PARTNER &&
      order.tradeAccountId !== user.tradeAccountId
    ) {
      throw new ForbiddenException(
        'You do not have permission to view this order.',
      );
    }

    return order;
  }

  // ─── PATCH /orders/:id/state: UPDATE ORDER STATE ──────────────────────────────

  async updateState(
    id: string,
    dto: UpdateOrderStateDto,
    user: UserDocument,
    ipAddress?: string,
  ): Promise<OrderDocument> {
    const order = await this.resolveOrder(id);
    const fromState = order.state;
    const toState = dto.state;

    order.state = toState;
    order.statusHistory.push({
      fromState,
      toState,
      changedBy: user.supabaseId,
      changedAt: new Date(),
      notes: dto.notes ?? null,
    });

    await order.save();

    await this.writeAudit(
      AuditAction.OVERRIDE,
      user.supabaseId,
      order.tradeAccountId,
      order.rooftopId,
      {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        fromState,
        toState,
        notes: dto.notes ?? null,
      },
      ipAddress,
    );

    return order;
  }

  // ─── POST /orders/:id/lines/:lineId/exception: RAISE EXCEPTION ON A LINE ──────

  async raiseLineException(
    orderId: string,
    lineId: string,
    dto: RaiseLineExceptionDto,
    user: UserDocument,
    ipAddress?: string,
  ): Promise<OrderDocument> {
    const order = await this.resolveOrder(orderId);

    const line = order.lines.find(
      (l) => l.lineId === lineId || l.partNumber === lineId,
    );
    if (!line) {
      throw new NotFoundException(
        `Line item ${lineId} not found in order ${order.orderNumber}.`,
      );
    }

    line.state = OrderLineState.EXCEPTION;
    line.exception = {
      reason: dto.reason,
      description: dto.description,
      raisedAt: new Date(),
      raisedBy: user.supabaseId,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
    };

    order.hasExceptions = true;

    if (
      order.state !== OrderState.DELIVERED &&
      order.state !== OrderState.CANCELLED
    ) {
      const fromState = order.state;
      order.state = OrderState.EXCEPTION;
      order.statusHistory.push({
        fromState,
        toState: OrderState.EXCEPTION,
        changedBy: user.supabaseId,
        changedAt: new Date(),
        notes: `Exception raised on line ${line.lineId} (${line.partNumber}): ${dto.reason} - ${dto.description}`,
      });
    }

    order.markModified('lines');
    await order.save();

    await this.writeAudit(
      AuditAction.EXCEPTION,
      user.supabaseId,
      order.tradeAccountId,
      order.rooftopId,
      {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        lineId: line.lineId,
        partNumber: line.partNumber,
        reason: dto.reason,
        description: dto.description,
      },
      ipAddress,
    );

    return order;
  }

  // ─── PATCH /orders/:id/lines/:lineId/re-source: RE-SOURCE A LINE ──────────────

  async reSourceLine(
    orderId: string,
    lineId: string,
    dto: ReSourceLineDto,
    user: UserDocument,
    ipAddress?: string,
  ): Promise<OrderDocument> {
    const order = await this.resolveOrder(orderId);

    const line = order.lines.find(
      (l) => l.lineId === lineId || l.partNumber === lineId,
    );
    if (!line) {
      throw new NotFoundException(
        `Line item ${lineId} not found in order ${order.orderNumber}.`,
      );
    }

    line.reSourceHistory.push({
      previousSourceKind: line.sourceKind,
      previousSourceName: line.sourceName,
      newSourceKind: dto.newSourceKind,
      newSourceName: dto.newSourceName,
      newSourceRooftopId: dto.newSourceRooftopId ?? null,
      reSourcedBy: user.supabaseId,
      reSourcedAt: new Date(),
      notes: dto.notes ?? null,
    });

    line.sourceKind = dto.newSourceKind;
    line.sourceName = dto.newSourceName;
    if (dto.newSourceRooftopId !== undefined) {
      line.sourceRooftopId = dto.newSourceRooftopId;
    }
    if (dto.newBinLocation !== undefined) {
      line.binLocation = dto.newBinLocation;
    }
    if (dto.newEta !== undefined) {
      line.eta = dto.newEta;
    }

    if (dto.newUnitPriceCents !== undefined) {
      line.unitPriceCents = dto.newUnitPriceCents;
      line.totalPriceCents =
        dto.newUnitPriceCents * line.quantity +
        line.coreChargeCents * line.quantity;
      this.recalculateOrderTotals(order);
    }

    if (line.exception) {
      line.exception.resolvedAt = new Date();
      line.exception.resolvedBy = user.supabaseId;
      line.exception.resolutionNotes =
        dto.notes || `Re-sourced to ${dto.newSourceName} (${dto.newSourceKind})`;
    }

    line.state = OrderLineState.SOURCING;

    const remainingExceptions = order.lines.some(
      (l) => l.state === OrderLineState.EXCEPTION,
    );
    order.hasExceptions = remainingExceptions;

    if (!remainingExceptions && order.state === OrderState.EXCEPTION) {
      const fromState = order.state;
      order.state = OrderState.PROCESSING;
      order.statusHistory.push({
        fromState,
        toState: OrderState.PROCESSING,
        changedBy: user.supabaseId,
        changedAt: new Date(),
        notes: `All line exceptions resolved. Re-sourced line ${line.lineId} to ${dto.newSourceName}.`,
      });
    }

    order.markModified('lines');
    await order.save();

    await this.writeAudit(
      AuditAction.OVERRIDE,
      user.supabaseId,
      order.tradeAccountId,
      order.rooftopId,
      {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        lineId: line.lineId,
        partNumber: line.partNumber,
        newSourceKind: dto.newSourceKind,
        newSourceName: dto.newSourceName,
        notes: dto.notes ?? null,
      },
      ipAddress,
    );

    return order;
  }

  // ─── PATCH /orders/:id/lines/:lineId/pick: CONFIRM PICK ON A LINE ─────────────

  async pickLine(
    orderId: string,
    lineId: string,
    dto: PickLineDto,
    user: UserDocument,
    ipAddress?: string,
  ): Promise<OrderDocument> {
    const order = await this.resolveOrder(orderId);

    const line = order.lines.find(
      (l) => l.lineId === lineId || l.partNumber === lineId,
    );
    if (!line) {
      throw new NotFoundException(
        `Line item ${lineId} not found in order ${order.orderNumber}.`,
      );
    }

    if (line.state === OrderLineState.CANCELLED) {
      throw new BadRequestException(
        `Cannot pick a cancelled line item ${line.lineId}.`,
      );
    }

    const pickedQty = dto.pickedQuantity ?? line.quantity;
    line.pickedQuantity = pickedQty;
    line.state = OrderLineState.PICKED;
    line.pickedAt = new Date();
    line.pickedBy = user.fullName || user.supabaseId;

    if (dto.binLocationConfirmed) {
      line.binLocation = dto.binLocationConfirmed;
    }

    order.pickedLinesCount = order.lines.filter(
      (l) => l.state === OrderLineState.PICKED,
    ).length;

    if (order.pickedLinesCount === order.totalLines) {
      if (order.state !== OrderState.PICKED) {
        const fromState = order.state;
        order.state = OrderState.PICKED;
        order.statusHistory.push({
          fromState,
          toState: OrderState.PICKED,
          changedBy: user.supabaseId,
          changedAt: new Date(),
          notes: `All ${order.totalLines} lines picked successfully.`,
        });
      }
    } else if (order.pickedLinesCount > 0) {
      if (
        order.state === OrderState.SUBMITTED ||
        order.state === OrderState.PROCESSING
      ) {
        const fromState = order.state;
        order.state = OrderState.PARTIALLY_PICKED;
        order.statusHistory.push({
          fromState,
          toState: OrderState.PARTIALLY_PICKED,
          changedBy: user.supabaseId,
          changedAt: new Date(),
          notes: `Line ${line.lineId} picked (${order.pickedLinesCount}/${order.totalLines} picked).`,
        });
      }
    }

    order.markModified('lines');
    await order.save();

    await this.writeAudit(
      AuditAction.PICK,
      user.supabaseId,
      order.tradeAccountId,
      order.rooftopId,
      {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        lineId: line.lineId,
        partNumber: line.partNumber,
        pickedQuantity: pickedQty,
        binLocation: line.binLocation,
      },
      ipAddress,
    );

    return order;
  }

  // ─── INTERNAL HELPERS ─────────────────────────────────────────────────────────

  private async resolveOrder(id: string): Promise<OrderDocument> {
    const isObjectId = Types.ObjectId.isValid(id) && id.length === 24;
    const query = isObjectId ? { $or: [{ _id: id }, { orderNumber: id }] } : { orderNumber: id };

    const doc = await this.orderModel.findOne(query);
    if (!doc) {
      throw new NotFoundException(`Order '${id}' not found.`);
    }
    return doc;
  }

  private recalculateOrderTotals(order: OrderDocument): void {
    let subtotalCents = 0;
    let coreChargeTotalCents = 0;

    for (const line of order.lines) {
      subtotalCents += line.unitPriceCents * line.quantity;
      coreChargeTotalCents += line.coreChargeCents * line.quantity;
    }

    const gstCents = Math.round((subtotalCents + coreChargeTotalCents) * 0.1);
    const totalCents = subtotalCents + coreChargeTotalCents + gstCents;

    order.subtotalCents = subtotalCents;
    order.coreChargeTotalCents = coreChargeTotalCents;
    order.gstCents = gstCents;
    order.totalCents = totalCents;
  }

  private generateOrderNumber(): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomHex = Math.random().toString(16).substring(2, 6).toUpperCase();
    return `ORD-${dateStr}-${randomHex}`;
  }

  private async writeAudit(
    action: AuditAction,
    userId: string,
    tradeAccountId: string | null,
    rooftopId: string | null,
    metadata: Record<string, any>,
    ipAddress?: string,
  ): Promise<void> {
    await this.auditModel.create({
      action,
      userId,
      tradeAccountId,
      rooftopId,
      metadata,
      ipAddress: ipAddress ?? null,
    });
  }
}
