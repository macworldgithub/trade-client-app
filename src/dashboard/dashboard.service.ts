import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import {
  PartsCheckRfq,
  PartsCheckRfqDocument,
} from '../partscheck/schemas/partscheck-rfq.schema';
import {
  TradeAccount,
  TradeAccountDocument,
} from '../accounts/schemas/account.schema';
import { Rooftop, RooftopDocument } from '../rooftops/schemas/rooftop.schema';
import {
  AuditEvent,
  AuditEventDocument,
  AuditAction,
} from '../auth/schemas/audit-event.schema';
import { UserDocument } from '../auth/schemas/user.schema';
import { Role } from '../common/enums/roles.enum';
import { OrderState } from '../orders/enums/order-state.enum';
import { RfqStatus } from '../partscheck/enums/rfq-status.enum';
import { WeeklyExportQueryDto, ExportFormat } from './dto/weekly-export-query.dto';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(PartsCheckRfq.name)
    private rfqModel: Model<PartsCheckRfqDocument>,
    @InjectModel(TradeAccount.name)
    private accountModel: Model<TradeAccountDocument>,
    @InjectModel(Rooftop.name) private rooftopModel: Model<RooftopDocument>,
    @InjectModel(AuditEvent.name)
    private auditModel: Model<AuditEventDocument>,
  ) {}

  // ─── GET /dashboard/group: C-SUITE NETWORK VIEW ───────────────────────────

  async getGroupView(user: UserDocument): Promise<Record<string, any>> {
    const currentYear = new Date().getFullYear();

    // Group-wide revenue and orders aggregation
    const [revenueAgg] = await this.orderModel.aggregate([
      { $match: { state: { $ne: OrderState.CANCELLED } } },
      {
        $group: {
          _id: null,
          totalRevenueCents: { $sum: '$totalCents' },
          totalSubtotalCents: { $sum: '$subtotalCents' },
          totalCoreChargeCents: { $sum: '$coreChargeTotalCents' },
          totalGstCents: { $sum: '$gstCents' },
          totalOrders: { $sum: 1 },
        },
      },
    ]);

    // Order status breakdown
    const [
      totalSubmitted,
      totalProcessing,
      totalPartiallyPicked,
      totalPicked,
      totalReadyForDelivery,
      totalDispatched,
      totalDelivered,
      totalExceptions,
      totalCancelled,
    ] = await Promise.all([
      this.orderModel.countDocuments({ state: OrderState.SUBMITTED }),
      this.orderModel.countDocuments({ state: OrderState.PROCESSING }),
      this.orderModel.countDocuments({ state: OrderState.PARTIALLY_PICKED }),
      this.orderModel.countDocuments({ state: OrderState.PICKED }),
      this.orderModel.countDocuments({ state: OrderState.READY_FOR_DELIVERY }),
      this.orderModel.countDocuments({ state: OrderState.DISPATCHED }),
      this.orderModel.countDocuments({ state: OrderState.DELIVERED }),
      this.orderModel.countDocuments({
        $or: [{ state: OrderState.EXCEPTION }, { hasExceptions: true }],
      }),
      this.orderModel.countDocuments({ state: OrderState.CANCELLED }),
    ]);

    // Accounts health rollup
    const [
      totalAccounts,
      activeAccounts,
      accountsOnCreditHold,
      overdueAccounts,
      totalCreditExposureCents,
    ] = await Promise.all([
      this.accountModel.countDocuments(),
      this.accountModel.countDocuments({ isActive: true }),
      this.accountModel.countDocuments({ creditHold: true }),
      this.accountModel.countDocuments({ isOverdue: true }),
      this.accountModel.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: null, totalBalance: { $sum: '$currentBalanceCents' } } },
      ]),
    ]);

    // Rooftops breakdown with real metrics
    const rooftops = await this.rooftopModel.find({ isActive: true }).lean().exec();

    const precinctBreakdown = await Promise.all(
      rooftops.map(async (rt) => {
        const [rtOrdersAgg] = await this.orderModel.aggregate([
          { $match: { rooftopId: rt.rooftopId, state: { $ne: OrderState.CANCELLED } } },
          {
            $group: {
              _id: null,
              revenueCents: { $sum: '$totalCents' },
              orderCount: { $sum: 1 },
            },
          },
        ]);

        const [activeExceptions, openRfqs] = await Promise.all([
          this.orderModel.countDocuments({
            rooftopId: rt.rooftopId,
            $or: [{ state: OrderState.EXCEPTION }, { hasExceptions: true }],
          }),
          this.rfqModel.countDocuments({
            rooftopId: rt.rooftopId,
            status: {
              $in: [
                RfqStatus.RECEIVED,
                RfqStatus.RESOLVING,
                RfqStatus.UNMAPPED_BUYER,
                RfqStatus.PENDING_REVIEW,
              ],
            },
          }),
        ]);

        return {
          rooftopId: rt.rooftopId,
          name: rt.name,
          code: rt.code,
          suburb: rt.suburb,
          oemBrandCodes: rt.oemBrandCodes,
          revenueCents: rtOrdersAgg?.revenueCents || 0,
          orderCount: rtOrdersAgg?.orderCount || 0,
          activeExceptions,
          openRfqs,
        };
      }),
    );

    // Recent critical audit activity
    const recentActivity = await this.auditModel
      .find({
        action: {
          $in: [
            AuditAction.ORDER_SUBMIT,
            AuditAction.PICK,
            AuditAction.EXCEPTION,
            AuditAction.PARTSCHECK_QUOTE_BACK,
          ],
        },
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
      .exec();

    return {
      generatedAt: new Date(),
      networkOverview: {
        totalRevenueCents: revenueAgg?.totalRevenueCents || 0,
        totalSubtotalCents: revenueAgg?.totalSubtotalCents || 0,
        totalGstCents: revenueAgg?.totalGstCents || 0,
        totalCoreChargeCents: revenueAgg?.totalCoreChargeCents || 0,
        totalOrders: revenueAgg?.totalOrders || 0,
        currentYear,
      },
      fulfillmentPipeline: {
        submitted: totalSubmitted,
        processing: totalProcessing,
        partiallyPicked: totalPartiallyPicked,
        picked: totalPicked,
        readyForDelivery: totalReadyForDelivery,
        dispatched: totalDispatched,
        delivered: totalDelivered,
        activeExceptions: totalExceptions,
        cancelled: totalCancelled,
        activeInPipeline:
          totalSubmitted +
          totalProcessing +
          totalPartiallyPicked +
          totalPicked +
          totalReadyForDelivery +
          totalDispatched,
      },
      accountsPortfolio: {
        totalAccounts,
        activeAccounts,
        accountsOnCreditHold,
        overdueAccounts,
        totalOutstandingBalanceCents:
          totalCreditExposureCents[0]?.totalBalance || 0,
      },
      precinctBreakdown,
      recentActivity,
    };
  }

  // ─── GET /dashboard/group/partscheck: GROUP PARTSCHECK TILES ──────────────

  async getGroupPartsCheckView(): Promise<Record<string, any>> {
    const [
      totalRfqs,
      autoQuotedCount,
      manuallyQuotedCount,
      unmappedBuyerCount,
      pendingReviewCount,
      acceptedCount,
      rejectedCount,
      expiredCount,
    ] = await Promise.all([
      this.rfqModel.countDocuments(),
      this.rfqModel.countDocuments({ status: RfqStatus.AUTO_QUOTED }),
      this.rfqModel.countDocuments({ status: RfqStatus.MANUALLY_QUOTED }),
      this.rfqModel.countDocuments({ status: RfqStatus.UNMAPPED_BUYER }),
      this.rfqModel.countDocuments({ status: RfqStatus.PENDING_REVIEW }),
      this.rfqModel.countDocuments({ status: RfqStatus.ACCEPTED }),
      this.rfqModel.countDocuments({ status: RfqStatus.REJECTED }),
      this.rfqModel.countDocuments({
        deadline: { $lt: new Date() },
        status: {
          $nin: [
            RfqStatus.AUTO_QUOTED,
            RfqStatus.MANUALLY_QUOTED,
            RfqStatus.ACCEPTED,
          ],
        },
      }),
    ]);

    const totalQuoted = autoQuotedCount + manuallyQuotedCount;
    const autoQuoteRate = totalRfqs > 0 ? (autoQuotedCount / totalRfqs) * 100 : 0;
    const unmappedRate = totalRfqs > 0 ? (unmappedBuyerCount / totalRfqs) * 100 : 0;
    const conversionRate = totalQuoted > 0 ? (acceptedCount / totalQuoted) * 100 : 0;

    // Total revenue generated from accepted PartsCheck RFQs
    const [acceptedRevenueAgg] = await this.rfqModel.aggregate([
      { $match: { status: RfqStatus.ACCEPTED } },
      { $group: { _id: null, totalRevenueCents: { $sum: '$totalCents' } } },
    ]);

    // Breakdown by precinct
    const rooftops = await this.rooftopModel.find({ isActive: true }).lean().exec();

    const precinctMetrics = await Promise.all(
      rooftops.map(async (rt) => {
        const [rtTotal, rtAuto, rtManual, rtAccepted, rtRevenue] =
          await Promise.all([
            this.rfqModel.countDocuments({ rooftopId: rt.rooftopId }),
            this.rfqModel.countDocuments({
              rooftopId: rt.rooftopId,
              status: RfqStatus.AUTO_QUOTED,
            }),
            this.rfqModel.countDocuments({
              rooftopId: rt.rooftopId,
              status: RfqStatus.MANUALLY_QUOTED,
            }),
            this.rfqModel.countDocuments({
              rooftopId: rt.rooftopId,
              status: RfqStatus.ACCEPTED,
            }),
            this.rfqModel.aggregate([
              {
                $match: {
                  rooftopId: rt.rooftopId,
                  status: RfqStatus.ACCEPTED,
                },
              },
              { $group: { _id: null, rev: { $sum: '$totalCents' } } },
            ]),
          ]);

        const rtQuoted = rtAuto + rtManual;
        return {
          rooftopId: rt.rooftopId,
          name: rt.name,
          code: rt.code,
          totalRfqs: rtTotal,
          autoQuoted: rtAuto,
          autoQuoteRatePercent: rtTotal > 0 ? (rtAuto / rtTotal) * 100 : 0,
          acceptedCount: rtAccepted,
          winRatePercent: rtQuoted > 0 ? (rtAccepted / rtQuoted) * 100 : 0,
          revenueCents: rtRevenue[0]?.rev || 0,
        };
      }),
    );

    return {
      generatedAt: new Date(),
      kpis: {
        totalRfqs,
        totalQuoted,
        autoQuotedCount,
        manuallyQuotedCount,
        autoQuoteRatePercent: Number(autoQuoteRate.toFixed(1)),
        unmappedBuyerCount,
        unmappedBuyerRatePercent: Number(unmappedRate.toFixed(1)),
        pendingReviewCount,
        acceptedCount,
        rejectedCount,
        conversionRatePercent: Number(conversionRate.toFixed(1)),
        totalRevenueCents: acceptedRevenueAgg?.totalRevenueCents || 0,
        slaBreachedCount: expiredCount,
        slaComplianceRatePercent:
          totalRfqs > 0
            ? Number((((totalRfqs - expiredCount) / totalRfqs) * 100).toFixed(1))
            : 100,
      },
      precinctMetrics,
    };
  }

  // ─── GET /dashboard/store/:rooftopId: STORE-MANAGER PRECINCT VIEW ─────────

  async getStoreView(
    rooftopId: string,
    user: UserDocument,
  ): Promise<Record<string, any>> {
    // Validate permission: store_manager can only view their assigned rooftop
    if (
      user.role === Role.STORE_MANAGER &&
      user.rooftopId &&
      user.rooftopId !== rooftopId
    ) {
      throw new ForbiddenException(
        `You do not have access to manage precinct ${rooftopId}.`,
      );
    }

    const rooftop = await this.rooftopModel.findOne({ rooftopId }).lean().exec();
    if (!rooftop) {
      throw new NotFoundException(`Rooftop precinct '${rooftopId}' not found.`);
    }

    // Precinct financial aggregation
    const [revAgg] = await this.orderModel.aggregate([
      { $match: { rooftopId, state: { $ne: OrderState.CANCELLED } } },
      {
        $group: {
          _id: null,
          totalRevenueCents: { $sum: '$totalCents' },
          totalOrders: { $sum: 1 },
        },
      },
    ]);

    // Today & This Week order volumes
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [todayOrders, weekOrders] = await Promise.all([
      this.orderModel.countDocuments({
        rooftopId,
        createdAt: { $gte: startOfToday },
        state: { $ne: OrderState.CANCELLED },
      }),
      this.orderModel.countDocuments({
        rooftopId,
        createdAt: { $gte: startOfWeek },
        state: { $ne: OrderState.CANCELLED },
      }),
    ]);

    // Live fulfillment queue at this precinct
    const [
      pendingPicking,
      partiallyPicked,
      pickedReady,
      dispatched,
      delivered,
      activeExceptions,
    ] = await Promise.all([
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
        state: { $in: [OrderState.PICKED, OrderState.READY_FOR_DELIVERY] },
      }),
      this.orderModel.countDocuments({
        rooftopId,
        state: OrderState.DISPATCHED,
      }),
      this.orderModel.countDocuments({
        rooftopId,
        state: OrderState.DELIVERED,
      }),
      this.orderModel.countDocuments({
        rooftopId,
        $or: [{ state: OrderState.EXCEPTION }, { hasExceptions: true }],
      }),
    ]);

    // Precinct trade accounts health
    const [
      precinctAccountsCount,
      creditHoldAccountsCount,
      overdueAccountsCount,
    ] = await Promise.all([
      this.accountModel.countDocuments({ rooftopId, isActive: true }),
      this.accountModel.countDocuments({
        rooftopId,
        isActive: true,
        creditHold: true,
      }),
      this.accountModel.countDocuments({
        rooftopId,
        isActive: true,
        isOverdue: true,
      }),
    ]);

    // Active PartsCheck RFQs count
    const [openRfqsCount, autoQuotedRfqsCount] = await Promise.all([
      this.rfqModel.countDocuments({
        rooftopId,
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
        rooftopId,
        status: RfqStatus.AUTO_QUOTED,
      }),
    ]);

    return {
      precinct: {
        rooftopId: rooftop.rooftopId,
        name: rooftop.name,
        code: rooftop.code,
        address: `${rooftop.address}, ${rooftop.suburb} ${rooftop.state} ${rooftop.postcode}`,
        phone: rooftop.phone,
        oemBrandCodes: rooftop.oemBrandCodes,
      },
      financialSummary: {
        totalRevenueCents: revAgg?.totalRevenueCents || 0,
        totalOrders: revAgg?.totalOrders || 0,
        todayOrdersCount: todayOrders,
        weekOrdersCount: weekOrders,
      },
      warehouseQueue: {
        pendingPicking,
        partiallyPicked,
        pickedReady,
        dispatched,
        delivered,
        activeExceptions,
        totalInQueue: pendingPicking + partiallyPicked + pickedReady,
      },
      accountsStatus: {
        totalAccounts: precinctAccountsCount,
        onCreditHold: creditHoldAccountsCount,
        overdue: overdueAccountsCount,
      },
      partscheckSummary: {
        openRfqs: openRfqsCount,
        autoQuoted: autoQuotedRfqsCount,
      },
    };
  }

  // ─── GET /dashboard/store/:rooftopId/partscheck: STORE SLA TILES ──────────

  async getStorePartsCheckView(
    rooftopId: string,
    user: UserDocument,
  ): Promise<Record<string, any>> {
    if (
      user.role === Role.STORE_MANAGER &&
      user.rooftopId &&
      user.rooftopId !== rooftopId
    ) {
      throw new ForbiddenException(
        `You do not have access to manage precinct ${rooftopId}.`,
      );
    }

    const [
      totalRfqs,
      autoQuoted,
      manuallyQuoted,
      unmappedBuyers,
      pendingReview,
      accepted,
      rejected,
      expired,
    ] = await Promise.all([
      this.rfqModel.countDocuments({ rooftopId }),
      this.rfqModel.countDocuments({ rooftopId, status: RfqStatus.AUTO_QUOTED }),
      this.rfqModel.countDocuments({
        rooftopId,
        status: RfqStatus.MANUALLY_QUOTED,
      }),
      this.rfqModel.countDocuments({
        rooftopId,
        status: RfqStatus.UNMAPPED_BUYER,
      }),
      this.rfqModel.countDocuments({
        rooftopId,
        status: RfqStatus.PENDING_REVIEW,
      }),
      this.rfqModel.countDocuments({ rooftopId, status: RfqStatus.ACCEPTED }),
      this.rfqModel.countDocuments({ rooftopId, status: RfqStatus.REJECTED }),
      this.rfqModel.countDocuments({
        rooftopId,
        deadline: { $lt: new Date() },
        status: {
          $nin: [
            RfqStatus.AUTO_QUOTED,
            RfqStatus.MANUALLY_QUOTED,
            RfqStatus.ACCEPTED,
          ],
        },
      }),
    ]);

    // Active urgent RFQs (expiring in less than 1 hour)
    const oneHourAhead = new Date(Date.now() + 3600 * 1000);
    const urgentExpiringCount = await this.rfqModel.countDocuments({
      rooftopId,
      deadline: { $gte: new Date(), $lte: oneHourAhead },
      status: {
        $in: [
          RfqStatus.RECEIVED,
          RfqStatus.UNMAPPED_BUYER,
          RfqStatus.PENDING_REVIEW,
        ],
      },
    });

    const totalQuoted = autoQuoted + manuallyQuoted;
    const autoQuoteRate = totalRfqs > 0 ? (autoQuoted / totalRfqs) * 100 : 0;
    const winRate = totalQuoted > 0 ? (accepted / totalQuoted) * 100 : 0;

    return {
      rooftopId,
      slaOverview: {
        totalRfqs,
        autoQuoted,
        manuallyQuoted,
        unmappedBuyers,
        pendingReview,
        accepted,
        rejected,
        expired,
        urgentExpiringWithin1Hour: urgentExpiringCount,
        autoQuoteRatePercent: Number(autoQuoteRate.toFixed(1)),
        winRatePercent: Number(winRate.toFixed(1)),
        slaComplianceRatePercent:
          totalRfqs > 0
            ? Number((((totalRfqs - expired) / totalRfqs) * 100).toFixed(1))
            : 100,
      },
    };
  }

  // ─── GET /dashboard/export/weekly: WEEKLY PDF/CSV PACK ────────────────────

  async getWeeklyExport(
    query: WeeklyExportQueryDto,
    user: UserDocument,
  ): Promise<{ data: any; csvString?: string; filename: string }> {
    const rooftopFilter = query.rooftopId ? { rooftopId: query.rooftopId } : {};

    // Determine target week date boundary
    const targetDate = query.week ? new Date(query.week) : new Date();
    const dayOfWeek = targetDate.getDay();
    const startOfWeek = new Date(targetDate);
    startOfWeek.setDate(targetDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const dateFilter = {
      createdAt: { $gte: startOfWeek, $lte: endOfWeek },
    };

    // 1. Orders within the target week
    const orders = await this.orderModel
      .find({
        ...rooftopFilter,
        ...dateFilter,
        state: { $ne: OrderState.CANCELLED },
      })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    // 2. PartsCheck RFQs within the target week
    const rfqs = await this.rfqModel
      .find({
        ...rooftopFilter,
        ...dateFilter,
      })
      .lean()
      .exec();

    // Summary calculations
    let weeklyRevenueCents = 0;
    let weeklyGstCents = 0;
    let weeklyCoreChargeCents = 0;
    const accountSpendMap: Record<string, { name: string; count: number; spendCents: number }> = {};
    const partVolumeMap: Record<string, { description: string; qty: number; spendCents: number }> = {};

    for (const order of orders) {
      weeklyRevenueCents += order.totalCents;
      weeklyGstCents += order.gstCents;
      weeklyCoreChargeCents += order.coreChargeTotalCents;

      const accId = order.tradeAccountId;
      if (!accountSpendMap[accId]) {
        accountSpendMap[accId] = {
          name: order.placedByName || accId,
          count: 0,
          spendCents: 0,
        };
      }
      accountSpendMap[accId].count += 1;
      accountSpendMap[accId].spendCents += order.totalCents;

      for (const line of order.lines) {
        if (!partVolumeMap[line.partNumber]) {
          partVolumeMap[line.partNumber] = {
            description: line.description,
            qty: 0,
            spendCents: 0,
          };
        }
        partVolumeMap[line.partNumber].qty += line.quantity;
        partVolumeMap[line.partNumber].spendCents += line.totalPriceCents;
      }
    }

    const topAccounts = Object.entries(accountSpendMap)
      .map(([accountId, info]) => ({ accountId, ...info }))
      .sort((a, b) => b.spendCents - a.spendCents)
      .slice(0, 10);

    const topParts = Object.entries(partVolumeMap)
      .map(([partNumber, info]) => ({ partNumber, ...info }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    const filename = `Weekly-Pack-${query.rooftopId || 'Group'}-${startOfWeek.toISOString().slice(0, 10)}.csv`;

    const reportData = {
      period: {
        from: startOfWeek,
        to: endOfWeek,
        rooftopId: query.rooftopId || 'ALL_PRECINCTS',
      },
      financialSummary: {
        totalOrdersCount: orders.length,
        totalRevenueAud: (weeklyRevenueCents / 100).toFixed(2),
        totalGstAud: (weeklyGstCents / 100).toFixed(2),
        totalCoreChargesAud: (weeklyCoreChargeCents / 100).toFixed(2),
      },
      partscheckSummary: {
        totalRfqs: rfqs.length,
        autoQuoted: rfqs.filter((r) => r.status === RfqStatus.AUTO_QUOTED).length,
        accepted: rfqs.filter((r) => r.status === RfqStatus.ACCEPTED).length,
      },
      topAccounts,
      topParts,
      orderRows: orders.map((o) => ({
        orderNumber: o.orderNumber,
        tradeAccountId: o.tradeAccountId,
        rooftopId: o.rooftopId,
        customerReference: o.customerReference,
        state: o.state,
        totalAud: (o.totalCents / 100).toFixed(2),
        lineCount: o.totalLines,
        createdAt: (o as any).createdAt,
      })),
    };

    if (query.format === ExportFormat.CSV) {
      // Build CSV String
      const csvLines: string[] = [];
      csvLines.push(`Booran Motor Group — Weekly Management Pack`);
      csvLines.push(`Period: ${startOfWeek.toISOString().slice(0, 10)} to ${endOfWeek.toISOString().slice(0, 10)}`);
      csvLines.push(`Rooftop Scope: ${query.rooftopId || 'Group Network'}`);
      csvLines.push('');
      csvLines.push('--- EXECUTIVE SUMMARY ---');
      csvLines.push(`Total Orders,${orders.length}`);
      csvLines.push(`Total Revenue (AUD),$${(weeklyRevenueCents / 100).toFixed(2)}`);
      csvLines.push(`Total GST (AUD),$${(weeklyGstCents / 100).toFixed(2)}`);
      csvLines.push(`PartsCheck RFQs,${rfqs.length}`);
      csvLines.push('');
      csvLines.push('--- TOP TRADE ACCOUNTS ---');
      csvLines.push('Account ID,Account Name,Orders Placed,Total Spend (AUD)');
      for (const acc of topAccounts) {
        csvLines.push(`"${acc.accountId}","${acc.name}",${acc.count},"$${(acc.spendCents / 100).toFixed(2)}"`);
      }
      csvLines.push('');
      csvLines.push('--- ORDER REGISTER ---');
      csvLines.push('Order Number,Trade Account,Rooftop,Reference,Status,Lines,Total (AUD),Created Date');
      for (const ord of reportData.orderRows) {
        csvLines.push(
          `"${ord.orderNumber}","${ord.tradeAccountId}","${ord.rooftopId}","${ord.customerReference || ''}","${ord.state}",${ord.lineCount},"$${ord.totalAud}","${new Date(ord.createdAt as any).toISOString()}"`,
        );
      }

      return {
        data: reportData,
        csvString: csvLines.join('\n'),
        filename,
      };
    }

    return {
      data: reportData,
      filename,
    };
  }
}
