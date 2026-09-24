import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TradeAccount, TradeAccountDocument } from './schemas/account.schema';
import { UserDocument } from '../auth/schemas/user.schema';
import { UpdateCreditHoldDto } from './dto/update-credit-hold.dto';
import { UpdateOverdueDto } from './dto/update-overdue.dto';
import { SpendQueryDto } from './dto/spend-query.dto';
import { Role } from '../common/enums/roles.enum';

@Injectable()
export class AccountsService {
  constructor(
    @InjectModel(TradeAccount.name)
    private accountModel: Model<TradeAccountDocument>,
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
    return {
      id: doc._id,
      accountId: doc.accountId,
      companyName: doc.companyName,
      contactName: doc.contactName,
      contactEmail: doc.contactEmail,
      contactPhone: doc.contactPhone,
      paymentTerms: doc.paymentTerms,
      creditLimitCents: doc.creditLimitCents,
      currentBalanceCents: doc.currentBalanceCents,
      discountPercent: doc.discountPercent,
      creditHold: doc.creditHold,
      isOverdue: doc.isOverdue,
      rooftopId: doc.rooftopId,
      lastSyncedAt: doc.lastSyncedAt,
      createdAt: (doc as any).createdAt,
      updatedAt: (doc as any).updatedAt,
    };
  }

  // ─── GET /accounts  (manager / admin) ─────────────────────────────────────

  async findAll(): Promise<ReturnType<typeof this.formatAccount>[]> {
    const docs = await this.accountModel
      .find({ isActive: true })
      .sort({ companyName: 1 });
    return docs.map((d) => this.formatAccount(d));
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
    discountPercent: number;
    creditHold: boolean;
    isOverdue: boolean;
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
      ytdSpendCents: isCurrent ? doc.ytdSpendCents : 0,
      ytdOrderCount: isCurrent ? doc.ytdOrderCount : 0,
      creditLimitCents: doc.creditLimitCents,
      currentBalanceCents: doc.currentBalanceCents,
      discountPercent: doc.discountPercent,
      creditHold: doc.creditHold,
      isOverdue: doc.isOverdue,
    };
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
