import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TradeAccount, TradeAccountDocument } from './schemas/account.schema';
import { PentanaEntity, PentanaEntityDocument } from './schemas/pentana-entity.schema';
import { UserDocument } from '../auth/schemas/user.schema';
import { UpdateCreditHoldDto } from './dto/update-credit-hold.dto';
import { UpdateOverdueDto } from './dto/update-overdue.dto';
import { SpendQueryDto } from './dto/spend-query.dto';
import { Role } from '../common/enums/roles.enum';
import { PentanaIngestionService } from '../integrations/pentana-ingestion.service';

@Injectable()
export class AccountsService {
  constructor(
    @InjectModel(TradeAccount.name)
    private accountModel: Model<TradeAccountDocument>,
    @InjectModel(PentanaEntity.name)
    private entityModel: Model<PentanaEntityDocument>,
    private readonly pentanaIngestion: PentanaIngestionService,
  ) {}

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Resolve a document by Mongo _id or Pentana accountId. Throws 404 if missing. */
  private async resolveAccount(id: string): Promise<TradeAccountDocument> {
    const doc = await this.accountModel.findOne({
      $or: [{ accountId: id }, { _id: id.match(/^[a-f\d]{24}$/i) ? id : null }],
      isActive: true,
    });
    if (!doc) {
      throw new NotFoundException(`Trade account '${id}' not found`);
    }
    return doc;
  }

  /** Cents → dollars shape returned on every account response */
  private formatAccount(doc: TradeAccountDocument) {
    const limit = doc.creditLimitCents ?? 0;
    const balance = doc.currentBalanceCents ?? 0;
    const available = doc.creditAvailableCents !== undefined && doc.creditAvailableCents !== null
      ? doc.creditAvailableCents
      : (limit - balance);

    return {
      id: doc._id,
      accountId: doc.accountId,
      companyName: doc.companyName,
      legalName: doc.legalName || doc.companyName,
      contactName: doc.contactName,
      contactEmail: doc.contactEmail,
      contactPhone: doc.contactPhone,
      businessPhone: doc.businessPhone || doc.contactPhone,
      mobilePhone: doc.mobilePhone,
      businessEmail: doc.businessEmail || doc.contactEmail,
      statementEmail: doc.statementEmail || doc.contactEmail,
      homeEmail: doc.homeEmail,
      abn: doc.abn,
      paymentTerms: doc.paymentTerms,
      creditLimitCents: limit,
      currentBalanceCents: balance,
      creditAvailableCents: available,
      aged30DaysCents: doc.aged30DaysCents ?? 0,
      aged60DaysCents: doc.aged60DaysCents ?? 0,
      aged90DaysCents: doc.aged90DaysCents ?? 0,
      aged120DaysCents: doc.aged120DaysCents ?? 0,
      agedBalanceTotalCents: doc.agedBalanceTotalCents ?? 0,
      discountPercent: doc.discountPercent,
      discountRate: doc.discountPercent,
      creditHold: doc.creditHold,
      isOverdue: doc.isOverdue,
      rooftopId: doc.rooftopId,
      homeRooftopId: doc.rooftopId,
      ytdSpendCents: doc.ytdSpendCents ?? (doc.partsSalesFinancialYearCents ?? 0),
      ytdOrderCount: doc.ytdOrderCount ?? (doc.partsTransactionsFinancialYear ?? 0),
      purchasePriorYearCents: doc.purchasePriorYearCents ?? 0,
      averageDaysToPay: doc.averageDaysToPay ?? 30,
      lastPurchaseDate: doc.lastPurchaseDate,
      lastPaymentDate: doc.lastPaymentDate,
      financialYearLabel: doc.financialYearLabel || '01/07/2026 - 30/06/2027',
      partsSalesFinancialYearCents: doc.partsSalesFinancialYearCents ?? 0,
      partsTransactionsFinancialYear: doc.partsTransactionsFinancialYear ?? 0,
      partsSaleTypeCode: doc.partsSaleTypeCode || 'T',
      partsSaleTypeLabel: doc.partsSaleTypeLabel || 'T, 52| TRADE SALES',
      priceLevelCode: doc.priceLevelCode || '20',
      priceLevelLabel: doc.priceLevelLabel || '20, DEALER',
      paymentMethodCode: doc.paymentMethodCode || '1',
      paymentMethodLabel: doc.paymentMethodLabel || 'CHARGE',
      creditTypeCode: doc.creditTypeCode || 'R',
      creditTypeLabel: doc.creditTypeLabel || 'Regular',
      creditCode: doc.creditCode || '1',
      creditCodeLabel: doc.creditCodeLabel || 'Good',
      creditComments: doc.creditComments || '',
      purchaseOrderRequired: !!doc.purchaseOrderRequired,
      billToEntityId: doc.billToEntityId,
      territoryLabel: doc.territoryLabel || 'No Selection',
      warningNotes: doc.warningNotes || [],
      isVerifiedPentana: !!doc.isVerifiedPentana,
      sourceEntityCode: doc.sourceEntityCode || '50',
      identifierType: doc.identifierType || 'PENTANA_ENTITY_ID',
      sourceScreens: doc.sourceScreens,
      lastSyncedAt: doc.lastSyncedAt,
      createdAt: (doc as any).createdAt,
      updatedAt: (doc as any).updatedAt,
    };
  }


  // ─── GET /accounts  (manager / admin) ─────────────────────────────────────

  async findAll(query?: import('./dto/query-accounts.dto').QueryAccountsDto) {
    const filter: Record<string, any> = { isActive: true };

    if (query?.search) {
      const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { accountId: regex },
        { companyName: regex },
        { legalName: regex },
        { abn: regex },
        { contactName: regex },
        { contactEmail: regex },
        { contactPhone: regex },
        { priceLevelLabel: regex },
      ];
    }

    if (query?.rooftopId && query.rooftopId !== 'ALL') {
      filter.rooftopId = query.rooftopId;
    }

    if (typeof query?.creditHold === 'boolean') {
      filter.creditHold = query.creditHold;
    }

    if (typeof query?.isOverdue === 'boolean') {
      filter.isOverdue = query.isOverdue;
    }

    const page = Math.max(1, Number(query?.page) || 1);
    const limit = query?.limit ? Math.min(100, Math.max(1, Number(query.limit))) : 20;
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      this.accountModel
        .find(filter)
        .sort({ companyName: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.accountModel.countDocuments(filter).exec(),
    ]);

    const formatted = docs.map((d) => this.formatAccount(d));

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      accounts: formatted,
      results: formatted,
    };
  }

  // ─── GET /accounts/my  (trade_partner's own account) ──────────────────────

  async findMine(user: UserDocument): Promise<ReturnType<typeof this.formatAccount>> {
    if (!user.tradeAccountId) {
      throw new ForbiddenException(
        'Your user profile is not linked to a trade account.',
      );
    }
    const doc = await this.resolveAccount(user.tradeAccountId);
    return this.formatAccount(doc);
  }

  // ─── GET /accounts/:id ────────────────────────────────────────────────────

  async findOne(id: string): Promise<ReturnType<typeof this.formatAccount>> {
    const doc = await this.resolveAccount(id);
    return this.formatAccount(doc);
  }

  // ─── PATCH /accounts/:id/credit-hold ─────────────────────────────────────

  async setCreditHold(
    id: string,
    dto: UpdateCreditHoldDto,
  ): Promise<ReturnType<typeof this.formatAccount>> {
    const doc = await this.resolveAccount(id);
    doc.creditHold = dto.creditHold;
    await doc.save();
    return this.formatAccount(doc);
  }

  // ─── PATCH /accounts/:id/overdue ─────────────────────────────────────────

  async setOverdue(
    id: string,
    dto: UpdateOverdueDto,
  ): Promise<ReturnType<typeof this.formatAccount>> {
    const doc = await this.resolveAccount(id);
    doc.isOverdue = dto.isOverdue;
    await doc.save();
    return this.formatAccount(doc);
  }

  // ─── GET /accounts/:id/spend ──────────────────────────────────────────────

  async getSpend(
    id: string,
    query: SpendQueryDto,
  ): Promise<{
    accountId: string;
    companyName: string;
    year: number;
    ytdSpendCents: number;
    ytdOrderCount: number;
    creditLimitCents: number;
    currentBalanceCents: number;
    creditAvailableCents?: number;
    discountPercent: number;
    creditHold: boolean;
    isOverdue: boolean;
    priceLevelLabel?: string;
    aged30DaysCents?: number;
    aged60DaysCents?: number;
    aged90DaysCents?: number;
    aged120DaysCents?: number;
    partsSalesFinancialYearCents?: number;
    partsTransactionsFinancialYear?: number;
    purchasePriorYearCents?: number;
    averageDaysToPay?: number;
    lastPurchaseDate?: string | null;
    lastPaymentDate?: string | null;
    warningNotes?: string[];
    abn?: string | null;
  }> {
    const doc = await this.resolveAccount(id);
    const requestedYear = query.year ?? new Date().getFullYear();

    // If the stored YTD year matches the requested year we can serve it
    // directly. If the client requests a historic year we return zeroes —
    // historic rollup would be sourced from a future orders module.
    const isCurrent = doc.ytdYear === requestedYear;

    return {
      accountId: doc.accountId,
      companyName: doc.companyName,
      year: requestedYear,
      ytdSpendCents: isCurrent ? (doc.ytdSpendCents ?? doc.partsSalesFinancialYearCents ?? 0) : 0,
      ytdOrderCount: isCurrent ? (doc.ytdOrderCount ?? doc.partsTransactionsFinancialYear ?? 0) : 0,
      creditLimitCents: doc.creditLimitCents,
      currentBalanceCents: doc.currentBalanceCents,
      creditAvailableCents: doc.creditAvailableCents ?? (doc.creditLimitCents - doc.currentBalanceCents),
      discountPercent: doc.discountPercent,
      creditHold: doc.creditHold,
      isOverdue: doc.isOverdue,
      priceLevelLabel: doc.priceLevelLabel,
      aged30DaysCents: doc.aged30DaysCents ?? 0,
      aged60DaysCents: doc.aged60DaysCents ?? 0,
      aged90DaysCents: doc.aged90DaysCents ?? 0,
      aged120DaysCents: doc.aged120DaysCents ?? 0,
      partsSalesFinancialYearCents: doc.partsSalesFinancialYearCents ?? 0,
      partsTransactionsFinancialYear: doc.partsTransactionsFinancialYear ?? 0,
      purchasePriorYearCents: doc.purchasePriorYearCents ?? 0,
      averageDaysToPay: doc.averageDaysToPay ?? 30,
      lastPurchaseDate: doc.lastPurchaseDate,
      lastPaymentDate: doc.lastPaymentDate,
      warningNotes: doc.warningNotes ?? [],
      abn: doc.abn,
    };
  }

  // ─── Pentana Integration & Entity Queries ─────────────────────────────────

  async syncPentanaData() {
    return this.pentanaIngestion.syncPentanaDataToDatabase();
  }

  async getDiscoveredEntities(query: {
    search?: string;
    suburb?: string;
    isTradeAccount?: boolean;
    page?: number;
    limit?: number;
  }) {
    return this.pentanaIngestion.getEntities(query);
  }

  getPentanaPriceLevels() {
    return this.pentanaIngestion.getPriceLevels();
  }

  getPentanaStatus() {
    return this.pentanaIngestion.getManifestMetadata();
  }

  // ─── Credit-hold guard (used by other modules) ────────────────────────────

  /**
   * Throws ForbiddenException if the account linked to the given user is on
   * credit hold. Call this at the start of any order-submission flow.
   */
  async assertNotOnCreditHold(user: UserDocument): Promise<void> {
    if (!user.tradeAccountId) return; // no account linked — let the order layer decide
    const doc = await this.accountModel.findOne({
      accountId: user.tradeAccountId,
      isActive: true,
    });
    if (doc?.creditHold) {
      throw new ForbiddenException(
        'Your account is currently on credit hold. Please contact your parts controller.',
      );
    }
  }
}

