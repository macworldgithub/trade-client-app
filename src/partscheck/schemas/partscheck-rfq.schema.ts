import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { RfqStatus, RfqLineStatus } from '../enums/rfq-status.enum';
import { SourceKind } from '../../parts/schemas/part-source.schema';

export type PartsCheckRfqDocument = PartsCheckRfq & Document;

@Schema({ _id: false })
export class VehicleInfo {
  @Prop({ type: String, default: null })
  make: string | null;

  @Prop({ type: String, default: null })
  model: string | null;

  @Prop({ type: Number, default: null })
  year: number | null;

  @Prop({ type: String, default: null })
  vin: string | null;

  @Prop({ type: String, default: null })
  rego: string | null;
}

export const VehicleInfoSchema = SchemaFactory.createForClass(VehicleInfo);

@Schema({ _id: false })
export class RfqLine {
  @Prop({ required: true })
  lineId: string; // e.g. "PC-LIN-01"

  @Prop({ required: true })
  partNumber: string;

  @Prop({ required: true })
  partNumberNormalised: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({
    type: String,
    enum: RfqLineStatus,
    default: RfqLineStatus.PENDING,
  })
  status: RfqLineStatus;

  @Prop({ type: String, enum: SourceKind, default: null })
  resolvedSourceKind: SourceKind | null;

  @Prop({ type: String, default: null })
  resolvedSourceName: string | null;

  @Prop({ type: String, default: null })
  resolvedSourceRooftopId: string | null;

  @Prop({ type: Number, default: null })
  listPriceCents: number | null;

  @Prop({ type: Number, default: null })
  unitTradePriceCents: number | null;

  @Prop({ type: Number, default: 0 })
  coreChargeCents: number;

  @Prop({ type: Number, default: null })
  totalPriceCents: number | null;

  @Prop({ type: Number, default: null })
  stockQty: number | null;

  @Prop({ default: false })
  inStock: boolean;

  @Prop({ type: String, default: null })
  eta: string | null;

  @Prop({ type: String, default: null })
  binLocation: string | null;

  @Prop({ default: false })
  isOverridden: boolean;

  @Prop({ type: String, default: null })
  overrideNotes: string | null;

  @Prop({ type: String, default: null })
  overrideBy: string | null;
}

export const RfqLineSchema = SchemaFactory.createForClass(RfqLine);

@Schema({ timestamps: true })
export class PartsCheckRfq {
  /** External PartsCheck RFQ identifier — e.g. "PC-RFQ-10293" */
  @Prop({ required: true, unique: true, index: true })
  rfqId: string;

  /** PartsCheck buyer / smash repairer account ID */
  @Prop({ required: true, index: true })
  buyerId: string;

  @Prop({ required: true })
  repairerName: string;

  @Prop({ type: String, default: null })
  repairerEmail: string | null;

  @Prop({ type: String, default: null })
  repairerPhone: string | null;

  /** Whether the PartsCheck buyer has been mapped to an active TradeAccount */
  @Prop({ required: true, default: false, index: true })
  isBuyerMapped: boolean;

  /** Mapped Pentana TradeAccount ID (null if unmapped) */
  @Prop({ type: String, default: null, index: true })
  tradeAccountId: string | null;

  /** Servicing rooftop precinct slug */
  @Prop({ required: true, index: true })
  rooftopId: string;

  @Prop({ type: String, default: null })
  claimNumber: string | null;

  @Prop({ type: String, default: null })
  repairOrderNumber: string | null;

  @Prop({ type: VehicleInfoSchema, default: null })
  vehicleDetails: VehicleInfo | null;

  /** Quoting cutoff SLA deadline */
  @Prop({ required: true, index: true })
  deadline: Date;

  /** Processing & quoting lifecycle state */
  @Prop({
    type: String,
    enum: RfqStatus,
    default: RfqStatus.RECEIVED,
    index: true,
  })
  status: RfqStatus;

  /** Line items requested in the RFQ */
  @Prop({ type: [RfqLineSchema], default: [] })
  lines: RfqLine[];

  @Prop({ default: 0 })
  subtotalCents: number;

  @Prop({ default: 0 })
  coreChargeTotalCents: number;

  @Prop({ default: 0 })
  gstCents: number;

  @Prop({ default: 0 })
  totalCents: number;

  @Prop({ type: Date, default: null })
  quotedAt: Date | null;

  @Prop({ type: String, default: null })
  quotedBy: string | null; // "SYSTEM_AUTO" or Supabase user ID

  @Prop({ type: Object, default: null })
  quotePayload: Record<string, any> | null;

  @Prop({ type: String, default: null })
  acceptedOrderId: string | null;
}

export const PartsCheckRfqSchema = SchemaFactory.createForClass(PartsCheckRfq);

// Compound indexes for controller inbox and SLA tracking
PartsCheckRfqSchema.index({ rooftopId: 1, status: 1, deadline: 1 });
PartsCheckRfqSchema.index({ isBuyerMapped: 1, status: 1 });
PartsCheckRfqSchema.index({ deadline: 1, status: 1 });
