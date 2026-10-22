import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Role } from '../../common/enums/roles.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  supabaseId: string; // Maps Supabase auth user to this MongoDB record

  @Prop({ required: true, unique: true })
  email: string;

  // Optional until native registration replaces Supabase registration.
  @Prop({ type: String, select: false })
  passwordHash?: string;

  @Prop({ default: false })
  totpEnabled: boolean;

  @Prop({ type: Number, default: 0 })
  mfaVersion: number;

  @Prop({ type: String, select: false })
  totpSecretEncrypted?: string;

  @Prop({ type: String, select: false })
  totpPendingSecretEncrypted?: string;

  @Prop({ type: String, select: false })
  totpPendingFactorId?: string;

  @Prop({ type: Date, select: false })
  totpPendingExpiresAt?: Date;

  @Prop({ type: Number, default: 0, select: false })
  totpPendingAttempts: number;

  @Prop({ type: Number, select: false })
  totpPendingPasswordVersion?: number;

  @Prop({ type: Number, default: -1, select: false })
  totpLastUsedStep: number;

  @Prop({ type: [String], default: [], select: false })
  totpRecoveryCodeHashes: string[];

  @Prop({ type: Date, default: null })
  emailVerifiedAt: Date | null;

  @Prop({ type: String, select: false })
  emailOtpChallengeHash?: string;

  @Prop({ type: String, select: false })
  emailOtpHash?: string;

  @Prop({ type: Date, select: false })
  emailOtpExpiresAt?: Date;

  @Prop({ type: Date, select: false })
  emailOtpSentAt?: Date;

  @Prop({ type: Number, select: false })
  emailOtpAttempts?: number;

  @Prop({ type: Date, select: false })
  emailOtpPasswordVersion?: Date | null;

  @Prop({ type: String, select: false })
  emailVerificationTokenHash?: string;

  @Prop({ type: Date, default: null, select: false })
  emailVerificationExpiresAt: Date | null;

  @Prop({ type: String, select: false })
  passwordResetTokenHash?: string;

  @Prop({ type: Date, default: null, select: false })
  passwordResetExpiresAt: Date | null;

  @Prop({ type: Date, select: false })
  passwordResetOtpVerifiedAt?: Date;

  @Prop({ type: Date, select: false })
  passwordResetPasswordVersion?: Date | null;

  @Prop({ type: String, select: false })
  recoveryOtpChallengeHash?: string;

  @Prop({ type: String, select: false })
  recoveryOtpHash?: string;

  @Prop({ type: Date, select: false })
  recoveryOtpExpiresAt?: Date;

  @Prop({ type: Date, select: false })
  recoveryOtpSentAt?: Date;

  @Prop({ type: Number, select: false })
  recoveryOtpAttempts?: number;

  @Prop({ type: Date, select: false })
  recoveryOtpPasswordVersion?: Date | null;

  @Prop({ type: Date, default: null })
  passwordChangedAt: Date | null;

  @Prop({ required: true })
  fullName: string;

  @Prop({ type: String, enum: Role, default: Role.TRADE_PARTNER })
  role: Role;

  // Reference to the TradeAccount in Pentana — one login = one trade account
  @Prop({ type: String, default: null })
  tradeAccountId: string | null;

  // Which rooftop/precinct this user belongs to (for store managers and controllers)
  @Prop({ type: String, default: null })
  rooftopId: string | null;

  @Prop({ default: true })
  isActive: boolean;

  // Credit hold flag synced from Pentana
  @Prop({ default: false })
  creditHold: boolean;

  // Overdue flag synced from Pentana
  @Prop({ default: false })
  isOverdue: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
