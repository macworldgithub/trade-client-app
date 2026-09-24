import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PartsCheckRfq,
  PartsCheckRfqDocument,
  RfqLine,
} from './schemas/partscheck-rfq.schema';
import {
  TradeAccount,
  TradeAccountDocument,
} from '../accounts/schemas/account.schema';
import { Rooftop, RooftopDocument } from '../rooftops/schemas/rooftop.schema';
import { Part, PartDocument } from '../parts/schemas/part.schema';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import {
  AuditEvent,
  AuditEventDocument,
  AuditAction,
} from '../auth/schemas/audit-event.schema';
import { UserDocument } from '../auth/schemas/user.schema';
import { RfqStatus, RfqLineStatus } from './enums/rfq-status.enum';
import { SourceKind } from '../parts/schemas/part-source.schema';
import { OrderState } from '../orders/enums/order-state.enum';
import { OrderLineState } from '../orders/enums/order-line-state.enum';
import { DeliveryMethod } from '../orders/enums/delivery-method.enum';
import { InboundRfqDto } from './dto/inbound-rfq.dto';
import { QueryRfqDto } from './dto/query-rfq.dto';
import { TriggerQuoteDto } from './dto/trigger-quote.dto';
import { OverrideRfqLineDto } from './dto/override-rfq-line.dto';
import { AcceptRfqDto } from './dto/accept-rfq.dto';

@Injectable()
export class PartsCheckService {
  constructor(
    @InjectModel(PartsCheckRfq.name)
    private rfqModel: Model<PartsCheckRfqDocument>,
    @InjectModel(TradeAccount.name)
    private accountModel: Model<TradeAccountDocument>,
    @InjectModel(Rooftop.name) private rooftopModel: Model<RooftopDocument>,
    @InjectModel(Part.name) private partModel: Model<PartDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(AuditEvent.name)
    private auditModel: Model<AuditEventDocument>,
  ) {}

  // ─── POST /partscheck/rfq: INBOUND WEBHOOK FROM PARTSCHECK ────────────────

  async handleInboundRfq(
    dto: InboundRfqDto,
    ipAddress?: string,
  ): Promise<PartsCheckRfqDocument> {
    // 1. Buyer mapping check (Scope 5.10: Unmapped buyers never auto-quote)
    let account: TradeAccountDocument | null = null;

    if (dto.tradeAccountId) {
      account = await this.accountModel.findOne({
        accountId: dto.tradeAccountId,
        isActive: true,
      });
    }

    if (!account && dto.buyerId) {
      account = await this.accountModel.findOne({
        $or: [
          { accountId: dto.buyerId },
          { companyName: new RegExp(`^${dto.repairerName.trim()}$`, 'i') },
        ],
        isActive: true,
      });
    }

    const isBuyerMapped = !!account;
    const tradeAccountId = account ? account.accountId : null;

    // 2. Resolve rooftop
    let rooftopId = dto.rooftopId || account?.rooftopId || 'ROOFTOP-DANDENONG';
    const rooftop = await this.rooftopModel.findOne({
      rooftopId,
      isActive: true,
    });
    if (!rooftop) {
      rooftopId = 'ROOFTOP-DANDENONG';
    }

    // 3. Resolve each line item using catalogue & pricing rules
    const rfqLines: RfqLine[] = [];
    let allLinesResolved = true;
    let subtotalCents = 0;
    let coreChargeTotalCents = 0;

    for (let i = 0; i < dto.lines.length; i++) {
      const lineDto = dto.lines[i];
      const partNumberNormalised = lineDto.partNumber
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase();

      const part = await this.partModel.findOne({
        partNumberNormalised,
        isActive: true,
      });

      const lineId = lineDto.lineId || `PC-LIN-${String(i + 1).padStart(2, '0')}`;
      const description =
        lineDto.description || part?.description || `Part ${lineDto.partNumber}`;

      if (part && isBuyerMapped && !account?.creditHold) {
        const discountMultiplier = 1 - (account?.discountPercent || 0) / 100;
        const listPrice = part.listPriceCents ?? 0;
        const unitTradePrice = Math.round(listPrice * discountMultiplier);
        const coreCharge = part.coreChargeCents ?? 0;
        const lineTotal =
          unitTradePrice * lineDto.quantity + coreCharge * lineDto.quantity;

        subtotalCents += unitTradePrice * lineDto.quantity;
        coreChargeTotalCents += coreCharge * lineDto.quantity;

        rfqLines.push({
          lineId,
          partNumber: lineDto.partNumber,
          partNumberNormalised,
          description,
          quantity: lineDto.quantity,
          status: RfqLineStatus.RESOLVED,
          resolvedSourceKind: SourceKind.BRANCH,
          resolvedSourceName: `${rooftop?.name || 'Own'} Parts`,
          resolvedSourceRooftopId: rooftopId,
          listPriceCents: listPrice,
          unitTradePriceCents: unitTradePrice,
          coreChargeCents: coreCharge,
          totalPriceCents: lineTotal,
          stockQty: null,
          inStock: true,
          eta: 'Same day',
          binLocation: null,
          isOverridden: false,
          overrideNotes: null,
          overrideBy: null,
        });
      } else {
        allLinesResolved = false;
        rfqLines.push({
          lineId,
          partNumber: lineDto.partNumber,
          partNumberNormalised,
          description,
          quantity: lineDto.quantity,
          status: RfqLineStatus.PENDING,
          resolvedSourceKind: null,
          resolvedSourceName: null,
          resolvedSourceRooftopId: null,
          listPriceCents: part?.listPriceCents ?? null,
          unitTradePriceCents: null,
          coreChargeCents: part?.coreChargeCents ?? 0,
          totalPriceCents: null,
          stockQty: null,
          inStock: false,
          eta: null,
          binLocation: null,
          isOverridden: false,
          overrideNotes: null,
          overrideBy: null,
        });
      }
    }

    const gstCents = Math.round((subtotalCents + coreChargeTotalCents) * 0.1);
    const totalCents = subtotalCents + coreChargeTotalCents + gstCents;

    // 4. Determine RFQ lifecycle status
    let status = RfqStatus.PENDING_REVIEW;
    let quotePayload: Record<string, any> | null = null;
    let quotedAt: Date | null = null;
    let quotedBy: string | null = null;

    if (!isBuyerMapped) {
      status = RfqStatus.UNMAPPED_BUYER;
    } else if (account?.creditHold) {
      status = RfqStatus.PENDING_REVIEW;
    } else if (allLinesResolved && rfqLines.length > 0) {
      status = RfqStatus.AUTO_QUOTED;
      quotedAt = new Date();
      quotedBy = 'SYSTEM_AUTO';
      quotePayload = {
        rfqId: dto.rfqId,
        buyerId: dto.buyerId,
        subtotalCents,
        coreChargeTotalCents,
        gstCents,
        totalCents,
        quotedAt,
        lines: rfqLines.map((l) => ({
          lineId: l.lineId,
          partNumber: l.partNumber,
          quantity: l.quantity,
          unitPriceCents: l.unitTradePriceCents,
          coreChargeCents: l.coreChargeCents,
          totalCents: l.totalPriceCents,
          sourceKind: l.resolvedSourceKind,
          sourceName: l.resolvedSourceName,
          eta: l.eta,
        })),
      };
    }

    // 5. Upsert RFQ document
    const rfqDoc = await this.rfqModel.findOneAndUpdate(
      { rfqId: dto.rfqId },
      {
        $set: {
          rfqId: dto.rfqId,
          buyerId: dto.buyerId,
          repairerName: dto.repairerName,
          repairerEmail: dto.repairerEmail ?? null,
          repairerPhone: dto.repairerPhone ?? null,
          isBuyerMapped,
          tradeAccountId,
          rooftopId,
          claimNumber: dto.claimNumber ?? null,
          repairOrderNumber: dto.repairOrderNumber ?? null,
          vehicleDetails: dto.vehicleDetails ?? null,
          deadline: new Date(dto.deadline),
          status,
          lines: rfqLines,
          subtotalCents,
          coreChargeTotalCents,
          gstCents,
          totalCents,
          quotedAt,
          quotedBy,
          quotePayload,
        },
      },
      { upsert: true, new: true },
    );

    // 6. Audit logs
    await this.writeAudit(
      AuditAction.PARTSCHECK_RFQ_IN,
      'PARTSCHECK_WEBHOOK',
      tradeAccountId,
      rooftopId,
      {
        rfqId: dto.rfqId,
        buyerId: dto.buyerId,
        repairerName: dto.repairerName,
        isBuyerMapped,
        status,
        lineCount: rfqLines.length,
      },
      ipAddress,
    );

    if (status === RfqStatus.AUTO_QUOTED) {
      await this.writeAudit(
        AuditAction.PARTSCHECK_QUOTE_BACK,
        'SYSTEM_AUTO',
        tradeAccountId,
        rooftopId,
        {
          rfqId: dto.rfqId,
          totalCents,
          autoQuoted: true,
        },
        ipAddress,
      );
    }

    return rfqDoc;
  }

  // ─── GET /partscheck/rfq: CONTROLLER INBOX + SLA CLOCK ────────────────────

  async getInbox(query: QueryRfqDto): Promise<{
    summary: {
      totalOpen: number;
      pendingReview: number;
      unmappedBuyers: number;
      autoQuoted: number;
      expiredCount: number;
    };
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
    rfqs: Array<Record<string, any>>;
  }> {
    const filter: Record<string, any> = {};

    if (query.rooftopId) {
      filter.rooftopId = query.rooftopId;
    }
    if (query.tradeAccountId) {
      filter.tradeAccountId = query.tradeAccountId;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.isBuyerMapped !== undefined) {
      filter.isBuyerMapped = query.isBuyerMapped;
    }

    if (query.search) {
      const searchRegex = new RegExp(query.search.trim(), 'i');
      filter.$or = [
        { rfqId: searchRegex },
        { repairerName: searchRegex },
        { claimNumber: searchRegex },
        { 'lines.partNumber': searchRegex },
      ];
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const baseFilter = query.rooftopId ? { rooftopId: query.rooftopId } : {};

    const [
      totalOpen,
      pendingReview,
      unmappedBuyers,
      autoQuoted,
      expiredCount,
      total,
      rawRfqs,
    ] = await Promise.all([
      this.rfqModel.countDocuments({
        ...baseFilter,
        status: {
          $in: [
            RfqStatus.RECEIVED,
            RfqStatus.RESOLVING,
            RfqStatus.UNMAPPED_BUYER,
            RfqStatus.PENDING_REVIEW,
          ],
        },
      }),
      this.rfqModel.countDocuments({
        ...baseFilter,
        status: RfqStatus.PENDING_REVIEW,
      }),
      this.rfqModel.countDocuments({
        ...baseFilter,
        status: RfqStatus.UNMAPPED_BUYER,
      }),
      this.rfqModel.countDocuments({
        ...baseFilter,
        status: RfqStatus.AUTO_QUOTED,
      }),
      this.rfqModel.countDocuments({
        ...baseFilter,
        deadline: { $lt: new Date() },
        status: {
          $nin: [
            RfqStatus.AUTO_QUOTED,
            RfqStatus.MANUALLY_QUOTED,
            RfqStatus.ACCEPTED,
          ],
        },
      }),
      this.rfqModel.countDocuments(filter),
      this.rfqModel
        .find(filter)
        // Sort urgent deadlines first
        .sort({ deadline: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    const now = Date.now();

    const rfqs = rawRfqs.map((rfq) => {
      const deadlineMs = new Date(rfq.deadline).getTime();
      const timeRemainingSeconds = Math.floor((deadlineMs - now) / 1000);
      const isExpired =
        timeRemainingSeconds <= 0 &&
        rfq.status !== RfqStatus.AUTO_QUOTED &&
        rfq.status !== RfqStatus.MANUALLY_QUOTED &&
        rfq.status !== RfqStatus.ACCEPTED;

      let urgency = 'LOW';
      if (timeRemainingSeconds < 3600) {
        urgency = 'HIGH';
      } else if (timeRemainingSeconds < 14400) {
        urgency = 'MEDIUM';
      }

      return {
        ...rfq,
        sla: {
          deadline: rfq.deadline,
          timeRemainingSeconds: Math.max(0, timeRemainingSeconds),
          isExpired,
          urgency,
        },
      };
    });

    return {
      summary: {
        totalOpen,
        pendingReview,
        unmappedBuyers,
        autoQuoted,
        expiredCount,
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      rfqs,
    };
  }

  // ─── GET /partscheck/rfq/:id: RFQ DETAIL + LINES + RESOLUTION STATUS ──────

  async findOne(id: string): Promise<Record<string, any>> {
    const rfq = await this.resolveRfq(id);

    const now = Date.now();
    const deadlineMs = new Date(rfq.deadline).getTime();
    const timeRemainingSeconds = Math.floor((deadlineMs - now) / 1000);
    const isExpired =
      timeRemainingSeconds <= 0 &&
      rfq.status !== RfqStatus.AUTO_QUOTED &&
      rfq.status !== RfqStatus.MANUALLY_QUOTED &&
      rfq.status !== RfqStatus.ACCEPTED;

    return {
      ...rfq.toObject(),
      sla: {
        deadline: rfq.deadline,
        timeRemainingSeconds: Math.max(0, timeRemainingSeconds),
        isExpired,
        urgency: timeRemainingSeconds < 3600 ? 'HIGH' : 'NORMAL',
      },
    };
  }

  // ─── POST /partscheck/rfq/:id/quote: MANUALLY TRIGGER QUOTE-BACK ──────────

  async triggerQuote(
    id: string,
    dto: TriggerQuoteDto,
    user: UserDocument,
    ipAddress?: string,
  ): Promise<PartsCheckRfqDocument> {
    const rfq = await this.resolveRfq(id);

    // Verify all lines have pricing
    for (const line of rfq.lines) {
      if (
        line.unitTradePriceCents === null ||
        line.unitTradePriceCents === undefined
      ) {
        throw new BadRequestException(
          `Cannot send quote: Line '${line.partNumber}' (${line.lineId}) has no trade price. Please override or resolve all lines first.`,
        );
      }
    }

    this.recalculateRfqTotals(rfq);

    rfq.status = RfqStatus.MANUALLY_QUOTED;
    rfq.quotedAt = new Date();
    rfq.quotedBy = user.supabaseId;
    rfq.quotePayload = {
      rfqId: rfq.rfqId,
      buyerId: rfq.buyerId,
      subtotalCents: rfq.subtotalCents,
      coreChargeTotalCents: rfq.coreChargeTotalCents,
      gstCents: rfq.gstCents,
      totalCents: rfq.totalCents,
      quotedAt: rfq.quotedAt,
      quotedBy: user.supabaseId,
      notes: dto.notes ?? null,
      lines: rfq.lines.map((l) => ({
        lineId: l.lineId,
        partNumber: l.partNumber,
        quantity: l.quantity,
        unitPriceCents: l.unitTradePriceCents,
        coreChargeCents: l.coreChargeCents,
        totalCents: l.totalPriceCents,
        sourceKind: l.resolvedSourceKind,
        sourceName: l.resolvedSourceName,
        eta: l.eta,
      })),
    };

    await rfq.save();

    await this.writeAudit(
      AuditAction.PARTSCHECK_QUOTE_BACK,
      user.supabaseId,
      rfq.tradeAccountId,
      rfq.rooftopId,
      {
        rfqId: rfq.rfqId,
        totalCents: rfq.totalCents,
        manualTrigger: true,
        notes: dto.notes ?? null,
      },
      ipAddress,
    );

    return rfq;
  }

  // ─── PATCH /partscheck/rfq/:id/lines/:lineId/override ─────────────────────

  async overrideLine(
    id: string,
    lineId: string,
    dto: OverrideRfqLineDto,
    user: UserDocument,
    ipAddress?: string,
  ): Promise<PartsCheckRfqDocument> {
    const rfq = await this.resolveRfq(id);

    const line = rfq.lines.find(
      (l) => l.lineId === lineId || l.partNumber === lineId,
    );
    if (!line) {
      throw new NotFoundException(
        `Line '${lineId}' not found in RFQ ${rfq.rfqId}.`,
      );
    }

    if (dto.partNumber) {
      line.partNumber = dto.partNumber;
      line.partNumberNormalised = dto.partNumber
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase();
    }
    if (dto.description) {
      line.description = dto.description;
    }

    line.unitTradePriceCents = dto.unitTradePriceCents;
    line.coreChargeCents = dto.coreChargeCents ?? 0;
    line.totalPriceCents =
      dto.unitTradePriceCents * line.quantity +
      line.coreChargeCents * line.quantity;

    line.resolvedSourceKind = dto.sourceKind ?? SourceKind.BRANCH;
    line.resolvedSourceName = dto.sourceName ?? 'Controller Override';
    if (dto.sourceRooftopId !== undefined) {
      line.resolvedSourceRooftopId = dto.sourceRooftopId;
    }
    if (dto.stockQty !== undefined) {
      line.stockQty = dto.stockQty;
    }
    if (dto.inStock !== undefined) {
      line.inStock = dto.inStock;
    }
    if (dto.eta !== undefined) {
      line.eta = dto.eta;
    }
    if (dto.binLocation !== undefined) {
      line.binLocation = dto.binLocation;
    }

    line.status = RfqLineStatus.OVERRIDDEN;
    line.isOverridden = true;
    line.overrideNotes = dto.notes;
    line.overrideBy = user.supabaseId;

    this.recalculateRfqTotals(rfq);

    // If all lines are now priced/resolved and RFQ was unmapped or pending, update to PENDING_REVIEW
    const allPriced = rfq.lines.every(
      (l) => l.unitTradePriceCents !== null && l.unitTradePriceCents !== undefined,
    );
    if (allPriced && rfq.status === RfqStatus.UNMAPPED_BUYER) {
      rfq.status = RfqStatus.PENDING_REVIEW;
    }

    rfq.markModified('lines');
    await rfq.save();

    await this.writeAudit(
      AuditAction.OVERRIDE,
      user.supabaseId,
      rfq.tradeAccountId,
      rfq.rooftopId,
      {
        rfqId: rfq.rfqId,
        lineId: line.lineId,
        partNumber: line.partNumber,
        unitTradePriceCents: dto.unitTradePriceCents,
        notes: dto.notes,
      },
      ipAddress,
    );

    return rfq;
  }

  // ─── POST /partscheck/rfq/:id/accept: REPAIRER ACCEPTS QUOTE ──────────────

  async acceptRfq(
    id: string,
    dto: AcceptRfqDto,
    user?: UserDocument,
    ipAddress?: string,
  ): Promise<OrderDocument> {
    const rfq = await this.resolveRfq(id);

    if (rfq.status === RfqStatus.ACCEPTED && rfq.acceptedOrderId) {
      const existingOrder = await this.orderModel.findById(rfq.acceptedOrderId);
      if (existingOrder) return existingOrder;
    }

    if (!rfq.tradeAccountId) {
      throw new BadRequestException(
        `Cannot raise TradeOrder: PartsCheck buyer '${rfq.buyerId}' is not mapped to a trade account.`,
      );
    }

    const orderLines = rfq.lines.map((l, idx) => ({
      lineId: `LIN-${String(idx + 1).padStart(2, '0')}`,
      partNumber: l.partNumber,
      partNumberNormalised: l.partNumberNormalised,
      brandCode: 'PARTSCHECK',
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitTradePriceCents ?? 0,
      coreChargeCents: l.coreChargeCents ?? 0,
      totalPriceCents: l.totalPriceCents ?? 0,
      sourceKind: l.resolvedSourceKind ?? SourceKind.BRANCH,
      sourceName: l.resolvedSourceName ?? 'PartsCheck Sourced',
      sourceRooftopId: l.resolvedSourceRooftopId,
      binLocation: l.binLocation,
      eta: l.eta,
      state: OrderLineState.PENDING,
      pickedQuantity: 0,
      pickedAt: null,
      pickedBy: null,
      exception: null,
      reSourceHistory: [],
    }));

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomHex = Math.random().toString(16).substring(2, 6).toUpperCase();
    const orderNumber = `ORD-PC-${dateStr}-${randomHex}`;

    const order = await this.orderModel.create({
      orderNumber,
      tradeAccountId: rfq.tradeAccountId,
      rooftopId: rfq.rooftopId,
      placedByUserId: user?.supabaseId ?? 'PARTSCHECK_SYSTEM',
      placedByEmail: rfq.repairerEmail ?? 'partscheck@booran.com.au',
      placedByName: rfq.repairerName,
      customerReference: `PartsCheck ${rfq.rfqId}${rfq.claimNumber ? ' / ' + rfq.claimNumber : ''}`,
      deliveryMethod: dto.deliveryMethod ?? DeliveryMethod.DELIVERY,
      deliveryAddress: dto.deliveryAddress ?? null,
      deliveryNotes: dto.deliveryNotes ?? 'Source: PARTSCHECK automated quote acceptance',
      state: OrderState.SUBMITTED,
      subtotalCents: rfq.subtotalCents,
      coreChargeTotalCents: rfq.coreChargeTotalCents,
      gstCents: rfq.gstCents,
      totalCents: rfq.totalCents,
      lines: orderLines,
      totalLines: orderLines.length,
      pickedLinesCount: 0,
      hasExceptions: false,
      statusHistory: [
        {
          fromState: OrderState.SUBMITTED,
          toState: OrderState.SUBMITTED,
          changedBy: user?.supabaseId ?? 'PARTSCHECK_SYSTEM',
          changedAt: new Date(),
          notes: `TradeOrder created from accepted PartsCheck RFQ ${rfq.rfqId}`,
        },
      ],
    });

    rfq.status = RfqStatus.ACCEPTED;
    rfq.acceptedOrderId = order._id.toString();
    await rfq.save();

    await this.writeAudit(
      AuditAction.ORDER_SUBMIT,
      user?.supabaseId ?? 'PARTSCHECK_SYSTEM',
      rfq.tradeAccountId,
      rfq.rooftopId,
      {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        source: 'PARTSCHECK',
        rfqId: rfq.rfqId,
      },
      ipAddress,
    );

    return order;
  }

  // ─── INTERNAL HELPERS ─────────────────────────────────────────────────────

  private async resolveRfq(id: string): Promise<PartsCheckRfqDocument> {
    const isObjectId = Types.ObjectId.isValid(id) && id.length === 24;
    const query = isObjectId ? { $or: [{ _id: id }, { rfqId: id }] } : { rfqId: id };

    const doc = await this.rfqModel.findOne(query);
    if (!doc) {
      throw new NotFoundException(`PartsCheck RFQ '${id}' not found.`);
    }
    return doc;
  }

  private recalculateRfqTotals(rfq: PartsCheckRfqDocument): void {
    let subtotalCents = 0;
    let coreChargeTotalCents = 0;

    for (const line of rfq.lines) {
      if (line.unitTradePriceCents !== null && line.unitTradePriceCents !== undefined) {
        subtotalCents += line.unitTradePriceCents * line.quantity;
      }
      if (line.coreChargeCents) {
        coreChargeTotalCents += line.coreChargeCents * line.quantity;
      }
    }

    const gstCents = Math.round((subtotalCents + coreChargeTotalCents) * 0.1);
    const totalCents = subtotalCents + coreChargeTotalCents + gstCents;

    rfq.subtotalCents = subtotalCents;
    rfq.coreChargeTotalCents = coreChargeTotalCents;
    rfq.gstCents = gstCents;
    rfq.totalCents = totalCents;
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
