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

  // ─── Pentana Deep Ingestion Fields (Entity 50 Extraction) ───────────────────

  /** Source Pentana entity code — e.g. "50" (Dandenong Mitsubishi & Hyundai) */
  @Prop({ type: String, default: '50' })
  sourceEntityCode: string;

  /** Identifier type — e.g. "PENTANA_ENTITY_ID" */
  @Prop({ type: String, default: 'PENTANA_ENTITY_ID' })
  identifierType: string;

  /** Registered legal business name */
  @Prop({ type: String, default: null })
  legalName: string | null;

  /** Australian Business Number (ABN) */
  @Prop({ type: String, default: null })
  abn: string | null;

  /** Statement email address from Pentana debtor ledger */
  @Prop({ type: String, default: null })
  statementEmail: string | null;

  /** Business email */
  @Prop({ type: String, default: null })
  businessEmail: string | null;

  /** Home / alternate email */
  @Prop({ type: String, default: null })
  homeEmail: string | null;

  /** Landline phone number */
  @Prop({ type: String, default: null })
  businessPhone: string | null;

  /** Mobile phone number */
  @Prop({ type: String, default: null })
  mobilePhone: string | null;

  /** Available credit in AUD cents (creditLimit - currentBalance) */
  @Prop({ type: Number, default: 0 })
  creditAvailableCents: number;

  /** Aged 30 days balance in AUD cents */
  @Prop({ type: Number, default: 0 })
  aged30DaysCents: number;

  /** Aged 60 days balance in AUD cents */
  @Prop({ type: Number, default: 0 })
  aged60DaysCents: number;

  /** Aged 90 days balance in AUD cents */
  @Prop({ type: Number, default: 0 })
  aged90DaysCents: number;

  /** Aged 120 days balance in AUD cents */
  @Prop({ type: Number, default: 0 })
  aged120DaysCents: number;

  /** Total aged balance in AUD cents */
  @Prop({ type: Number, default: 0 })
  agedBalanceTotalCents: number;

  /** Average days to pay invoices */
  @Prop({ type: Number, default: 30 })
  averageDaysToPay: number;

  /** Last purchase date string (e.g. "20/10/2026") */
  @Prop({ type: String, default: null })
  lastPurchaseDate: string | null;

  /** Last payment date string (e.g. "09/09/2026") */
  @Prop({ type: String, default: null })
  lastPaymentDate: string | null;

  /** Prior financial year total purchases in AUD cents */
  @Prop({ type: Number, default: 0 })
  purchasePriorYearCents: number;

  /** Active financial year label — e.g. "01/07/2026 - 30/06/2027" */
  @Prop({ type: String, default: '01/07/2026 - 30/06/2027' })
  financialYearLabel: string;

  /** Financial year parts sales in AUD cents */
  @Prop({ type: Number, default: 0 })
  partsSalesFinancialYearCents: number;

  /** Financial year parts invoice transaction count */
  @Prop({ type: Number, default: 0 })
  partsTransactionsFinancialYear: number;

  /** Pentana parts sale type code — e.g. "T" (Trade), "D" (Dealer) */
  @Prop({ type: String, default: 'T' })
  partsSaleTypeCode: string;

  /** Pentana parts sale type label — e.g. "T, 52| TRADE SALES" */
  @Prop({ type: String, default: 'T, 52| TRADE SALES' })
  partsSaleTypeLabel: string;

  /** Pentana price level code — e.g. "20", "25", "11", "13" */
  @Prop({ type: String, default: '20' })
  priceLevelCode: string;

  /** Pentana price level label — e.g. "20, DEALER", "25, list less 25", "11, TRADE" */
  @Prop({ type: String, default: '20, DEALER' })
  priceLevelLabel: string;

  /** Pentana payment method code — e.g. "1" (Charge), "6" (Pending) */
  @Prop({ type: String, default: '1' })
  paymentMethodCode: string;

  /** Pentana payment method label — e.g. "CHARGE", "PENDING" */
  @Prop({ type: String, default: 'CHARGE' })
  paymentMethodLabel: string;

  /** Credit type code and label */
  @Prop({ type: String, default: 'R' })
  creditTypeCode: string;

  @Prop({ type: String, default: 'Regular' })
  creditTypeLabel: string;

  /** Credit code and label (e.g. "1" / "Good", "2" / "Slow") */
  @Prop({ type: String, default: '1' })
  creditCode: string;

  @Prop({ type: String, default: 'Good' })
  creditCodeLabel: string;

  /** Internal credit comments */
  @Prop({ type: String, default: '' })
  creditComments: string;

  /** Whether purchase order is mandatory on orders */
  @Prop({ type: Boolean, default: false })
  purchaseOrderRequired: boolean;

  /** Bill-to entity ID (if head-office billed) */
  @Prop({ type: String, default: null })
  billToEntityId: string | null;

  /** Sales territory label */
  @Prop({ type: String, default: 'No Selection' })
  territoryLabel: string;

  /** Internal notepad warnings from Pentana NotePadWarnings.htm */
  @Prop({ type: [String], default: [] })
  warningNotes: string[];

  /** Verified directly against live Pentana extraction bundle */
  @Prop({ type: Boolean, default: false })
  isVerifiedPentana: boolean;

  /** Source screens captured */
  @Prop({ type: String, default: null })
  sourceScreens: string | null;
}

export const TradeAccountSchema = SchemaFactory.createForClass(TradeAccount);

// Fast lookups
TradeAccountSchema.index({ isActive: 1 });
TradeAccountSchema.index({ rooftopId: 1 });
TradeAccountSchema.index({ creditHold: 1 });
TradeAccountSchema.index({ isVerifiedPentana: 1 });
TradeAccountSchema.index({ sourceEntityCode: 1 });
TradeAccountSchema.index({ abn: 1 });
