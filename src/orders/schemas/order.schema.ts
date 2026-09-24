import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { OrderState } from '../enums/order-state.enum';
import { OrderLineState } from '../enums/order-line-state.enum';
import { LineExceptionReason } from '../enums/line-exception-reason.enum';
import { DeliveryMethod } from '../enums/delivery-method.enum';
import { SourceKind } from '../../parts/schemas/part-source.schema';

export type OrderDocument = Order & Document;

@Schema({ _id: false })
export class LineException {
  @Prop({ type: String, enum: LineExceptionReason, required: true })
  reason: LineExceptionReason;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true, default: () => new Date() })
  raisedAt: Date;

  @Prop({ required: true })
  raisedBy: string; // Supabase user ID / email

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  @Prop({ type: String, default: null })
  resolvedBy: string | null;

  @Prop({ type: String, default: null })
  resolutionNotes: string | null;
}

export const LineExceptionSchema = SchemaFactory.createForClass(LineException);

@Schema({ _id: false })
export class ReSourceHistoryEntry {
  @Prop({ type: String, enum: SourceKind, required: true })
  previousSourceKind: SourceKind;

  @Prop({ required: true })
  previousSourceName: string;

  @Prop({ type: String, enum: SourceKind, required: true })
  newSourceKind: SourceKind;

  @Prop({ required: true })
  newSourceName: string;

  @Prop({ type: String, default: null })
  newSourceRooftopId: string | null;

  @Prop({ required: true })
  reSourcedBy: string;

  @Prop({ required: true, default: () => new Date() })
  reSourcedAt: Date;

  @Prop({ type: String, default: null })
  notes: string | null;
}

export const ReSourceHistoryEntrySchema =
  SchemaFactory.createForClass(ReSourceHistoryEntry);

@Schema({ _id: false })
export class StatusHistoryEntry {
  @Prop({ type: String, enum: OrderState, required: true })
  fromState: OrderState;

  @Prop({ type: String, enum: OrderState, required: true })
  toState: OrderState;

  @Prop({ required: true })
  changedBy: string;

  @Prop({ required: true, default: () => new Date() })
  changedAt: Date;

  @Prop({ type: String, default: null })
  notes: string | null;
}

export const StatusHistoryEntrySchema =
  SchemaFactory.createForClass(StatusHistoryEntry);

@Schema()
export class OrderLine {
  @Prop({ required: true })
  lineId: string; // e.g. "LIN-01", "LIN-02"

  @Prop({ required: true })
  partNumber: string;

  @Prop({ required: true })
  partNumberNormalised: string;

  @Prop({ required: true })
  brandCode: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true, default: 0 })
  unitPriceCents: number;

  @Prop({ default: 0 })
  coreChargeCents: number;

  @Prop({ required: true, default: 0 })
  totalPriceCents: number;

  @Prop({ type: String, enum: SourceKind, default: SourceKind.BRANCH })
  sourceKind: SourceKind;

  @Prop({ required: true, default: 'Own Branch' })
  sourceName: string;

  @Prop({ type: String, default: null })
  sourceRooftopId: string | null;

  @Prop({ type: String, default: null })
  binLocation: string | null;

  @Prop({ type: String, default: null })
  eta: string | null;

  @Prop({
    type: String,
    enum: OrderLineState,
    default: OrderLineState.PENDING,
  })
  state: OrderLineState;

  @Prop({ default: 0 })
  pickedQuantity: number;

  @Prop({ type: Date, default: null })
  pickedAt: Date | null;

  @Prop({ type: String, default: null })
  pickedBy: string | null;

  @Prop({ type: LineExceptionSchema, default: null })
  exception: LineException | null;

  @Prop({ type: [ReSourceHistoryEntrySchema], default: [] })
  reSourceHistory: ReSourceHistoryEntry[];
}

export const OrderLineSchema = SchemaFactory.createForClass(OrderLine);

@Schema({ timestamps: true })
export class Order {
  /** Canonical human-readable order identifier — e.g. "ORD-20260924-A1B2" */
  @Prop({ required: true, unique: true })
  orderNumber: string;

  /** Trade account ID the order was placed under (Pentana account slug) */
  @Prop({ required: true, index: true })
  tradeAccountId: string;

  /** Servicing / Destination rooftop precinct slug */
  @Prop({ required: true, index: true })
  rooftopId: string;

  /** User identity info of creator */
  @Prop({ required: true, index: true })
  placedByUserId: string;

  @Prop({ required: true })
  placedByEmail: string;

  @Prop({ required: true })
  placedByName: string;

  /** Workshop purchase order / repair order / vehicle rego reference */
  @Prop({ type: String, default: null, index: true })
  customerReference: string | null;

  /** Delivery or trade counter collection */
  @Prop({
    type: String,
    enum: DeliveryMethod,
    default: DeliveryMethod.DELIVERY,
  })
  deliveryMethod: DeliveryMethod;

  @Prop({ type: String, default: null })
  deliveryAddress: string | null;

  @Prop({ type: String, default: null })
  deliveryNotes: string | null;

  /** Overall order status lifecycle */
  @Prop({
    type: String,
    enum: OrderState,
    default: OrderState.SUBMITTED,
    index: true,
  })
  state: OrderState;

  /** Pricing summary in AUD cents */
  @Prop({ required: true, default: 0 })
  subtotalCents: number;

  @Prop({ default: 0 })
  coreChargeTotalCents: number;

  @Prop({ required: true, default: 0 })
  gstCents: number;

  @Prop({ required: true, default: 0 })
  totalCents: number;

  /** Line items */
  @Prop({ type: [OrderLineSchema], default: [] })
  lines: OrderLine[];

  @Prop({ required: true, default: 0 })
  totalLines: number;

  @Prop({ default: 0 })
  pickedLinesCount: number;

  /** Quick flag indicating whether any line has an active un-resolved exception */
  @Prop({ default: false, index: true })
  hasExceptions: boolean;

  /** Audit log of state transitions */
  @Prop({ type: [StatusHistoryEntrySchema], default: [] })
  statusHistory: StatusHistoryEntry[];
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// Compound indexes for fast search & controller queue queries
OrderSchema.index({ tradeAccountId: 1, createdAt: -1 });
OrderSchema.index({ rooftopId: 1, state: 1, createdAt: -1 });
OrderSchema.index({ rooftopId: 1, hasExceptions: 1 });
OrderSchema.index({ createdAt: -1 });
