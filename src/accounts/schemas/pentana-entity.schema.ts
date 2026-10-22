import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PentanaEntityDocument = PentanaEntity & Document;

/**
 * PentanaEntity represents a contact/business entity record discovered in Pentana
 * (e.g. 185 contacts from entity 50 Dandenong Mitsubishi & Hyundai).
 */
@Schema({ timestamps: true })
export class PentanaEntity {
  /** Pentana Entity ID — preserved as string with leading zeros if present */
  @Prop({ required: true, unique: true, index: true })
  entityId: string;

  /** Pentana Source Entity Code (e.g. "50") */
  @Prop({ type: String, default: '50', index: true })
  sourceEntityCode: string;

  /** Display entity name from Pentana */
  @Prop({ required: true, index: true })
  entityName: string;

  /** Trading/business name */
  @Prop({ type: String, default: '' })
  businessName: string;

  /** Contact person name if present */
  @Prop({ type: String, default: '' })
  contactName: string;

  /** First & last name */
  @Prop({ type: String, default: '' })
  firstName: string;

  @Prop({ type: String, default: '' })
  lastName: string;

  /** Street address line 1 */
  @Prop({ type: String, default: '' })
  addressLine1: string;

  /** Street address line 2 */
  @Prop({ type: String, default: '' })
  addressLine2: string;

  /** Suburb (e.g. DANDENONG, SUNSHINE, BRAESIDE) */
  @Prop({ type: String, default: '', index: true })
  suburb: string;

  /** Postcode (e.g. 3175, 3020) */
  @Prop({ type: String, default: '' })
  postcode: string;

  /** State (e.g. VIC) */
  @Prop({ type: String, default: 'VIC' })
  state: string;

  /** Business email */
  @Prop({ type: String, default: '' })
  businessEmail: string;

  /** Home or alternative email */
  @Prop({ type: String, default: '' })
  homeEmail: string;

  /** Business phone */
  @Prop({ type: String, default: '' })
  businessPhone: string;

  /** Mobile phone */
  @Prop({ type: String, default: '' })
  mobilePhone: string;

  /** ABN (Australian Business Number) */
  @Prop({ type: String, default: '', index: true })
  abn: string;

  /** ACN */
  @Prop({ type: String, default: '' })
  acn: string;

  /** Pentana raw entity type code (e.g. CP, C) */
  @Prop({ type: String, default: '' })
  entityTypeRaw: string;

  /** Customer type detail raw string */
  @Prop({ type: String, default: '' })
  customerTypeDetailRaw: string;

  /** Detail capture status in extraction (e.g. "CAPTURED") */
  @Prop({ type: String, default: 'CAPTURED' })
  detailCaptureStatus: string;

  /** Whether this entity has an active TradeAccount ledger record (1 of the 34) */
  @Prop({ type: Boolean, default: false, index: true })
  isTradeAccount: boolean;

  /** Linked TradeAccount ID if enrolled */
  @Prop({ type: String, default: null })
  linkedAccountId: string | null;

  /** Captured timestamp from extraction bundle */
  @Prop({ type: Date, default: null })
  capturedAt: Date | null;
}

export const PentanaEntitySchema = SchemaFactory.createForClass(PentanaEntity);
PentanaEntitySchema.index({ entityName: 'text', businessName: 'text', suburb: 'text', abn: 'text' });
