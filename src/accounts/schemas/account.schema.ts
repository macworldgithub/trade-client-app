import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TradeAccountDocument = TradeAccount & Document;

/**
 * TradeAccount mirrors the account record pulled from Pentana.
 * One login maps to exactly one trade account (stored as User.tradeAccountId).
 * The account panel data lives here; credit-hold blocks order submission.
 */
@Schema({ timestamps: true })
export class TradeAccount {
  // ─── Pentana identity ────────────────────────────────────────────────────────

  /**
   * Canonical Pentana account ID — used as the external reference across
   * all modules. e.g. "ACC-000123". Required, unique, indexed.
   */
  @Prop({ required: true, unique: true })
  accountId: string;

  /** Trading/company name as stored in Pentana */
  @Prop({ required: true })
  companyName: string;

  /** Primary contact full name */
  @Prop({ required: true })
  contactName: string;

  /** Primary contact email */
  @Prop({ required: true })
  contactEmail: string;

  /** Primary contact phone */
  @Prop({ type: String, default: null })
  contactPhone: string | null;

  // ─── Terms & credit ──────────────────────────────────────────────────────────

  /**
   * Payment terms — e.g. "NET30", "COD", "EOM"
   * Sourced from Pentana account record.
   */
  @Prop({ type: String, default: null })
  paymentTerms: string | null;

  /**
   * Approved credit limit in AUD cents (integer) to avoid floating-point
   * issues. e.g. 1000000 = $10,000.00
   */
  @Prop({ type: Number, default: 0 })
  creditLimitCents: number;

  /**
   * Current outstanding balance in AUD cents.
   * Updated on every Pentana sync.
   */
  @Prop({ type: Number, default: 0 })
  currentBalanceCents: number;

  /**
   * Trade discount percentage applied at order time.
   * e.g. 15.5 = 15.5% off list price.
   */
  @Prop({ type: Number, default: 0 })
  discountPercent: number;

  // ─── Status flags ────────────────────────────────────────────────────────────

  /**
   * Credit hold flag — set by parts_controller/store_manager/group_admin.
   * When true the account cannot submit new orders.
   */
  @Prop({ default: false })
  creditHold: boolean;

  /**
   * Overdue flag — indicates one or more invoices are past due.
   * Set/unset by parts_controller/store_manager/group_admin.
   */
  @Prop({ default: false })
  isOverdue: boolean;

  /** Soft-delete / deactivation flag */
  @Prop({ default: true })
  isActive: boolean;

  // ─── YTD financials ──────────────────────────────────────────────────────────

  /**
   * Year-to-date spend in AUD cents (calendar year, reset each January).
   * Incremented on every confirmed order.
   */
  @Prop({ type: Number, default: 0 })
  ytdSpendCents: number;

  /**
   * Year-to-date order count (same boundary as ytdSpendCents).
   */
  @Prop({ type: Number, default: 0 })
  ytdOrderCount: number;

  /**
   * Calendar year the YTD figures belong to — e.g. 2026.
   * Allows detection of stale figures when the year rolls over.
   */
  @Prop({ type: Number, default: () => new Date().getFullYear() })
  ytdYear: number;

  // ─── Rooftop scoping ─────────────────────────────────────────────────────────

  /**
   * The rooftop (precinct) this account is primarily serviced by.
   * Mirrors User.rooftopId for the linked trade partner.
   */
  @Prop({ type: String, default: null })
  rooftopId: string | null;

  /** Last time data was synced from Pentana */
  @Prop({ type: Date, default: null })
  lastSyncedAt: Date | null;
}

export const TradeAccountSchema = SchemaFactory.createForClass(TradeAccount);

// Fast lookups
TradeAccountSchema.index({ accountId: 1 });
TradeAccountSchema.index({ isActive: 1 });
TradeAccountSchema.index({ rooftopId: 1 });
TradeAccountSchema.index({ creditHold: 1 });
