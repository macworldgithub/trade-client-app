import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuditEventDocument = AuditEvent & Document;

export enum AuditAction {
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  SEARCH = 'SEARCH',
  SOURCE_RESOLVE = 'SOURCE_RESOLVE',
  BASKET_ADD = 'BASKET_ADD',
  ORDER_SUBMIT = 'ORDER_SUBMIT',
  PICK = 'PICK',
  EXCEPTION = 'EXCEPTION',
  OVERRIDE = 'OVERRIDE',
  PARTSCHECK_RFQ_IN = 'PARTSCHECK_RFQ_IN',
  PARTSCHECK_QUOTE_BACK = 'PARTSCHECK_QUOTE_BACK',
}

@Schema({ timestamps: true })
export class AuditEvent {
  @Prop({ required: true })
  action: AuditAction;

  @Prop({ required: true })
  userId: string; // supabaseId or 'anonymous'

  @Prop({ type: String, default: null })
  tradeAccountId: string | null;

  @Prop({ type: String, default: null })
  rooftopId: string | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>; // additional context (orderId, partNumber, etc.)

  @Prop({ type: String, default: null })
  ipAddress: string | null;
}

export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);

// Retain audit events for 24 months as per scope (63,072,000 seconds)
AuditEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 63072000 });

// Compound query indexes for audit stream filtering
AuditEventSchema.index({ userId: 1, createdAt: -1 });
AuditEventSchema.index({ rooftopId: 1, createdAt: -1 });
AuditEventSchema.index({ tradeAccountId: 1, createdAt: -1 });
AuditEventSchema.index({ action: 1, createdAt: -1 });
AuditEventSchema.index({ 'metadata.orderId': 1 });
AuditEventSchema.index({ 'metadata.orderNumber': 1 });
