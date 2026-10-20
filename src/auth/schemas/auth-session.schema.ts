import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { User } from './user.schema';

export type AuthSessionDocument = HydratedDocument<AuthSession>;

@Schema({ timestamps: true })
export class AuthSession {
  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  // Sessions in the same family can be revoked together on refresh-token reuse.
  @Prop({ type: String, required: true })
  familyId: string;

  @Prop({ type: Number, default: 0 })
  passwordVersion: number;

  @Prop({ type: Number, default: 0 })
  mfaVersion: number;

  // Store only a digest; the raw refresh token belongs to the client.
  @Prop({ type: String, required: true, select: false })
  refreshTokenHash: string;

  @Prop({ type: [String], default: [], select: false })
  usedRefreshTokenHashes: string[];

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: AuthSession.name, default: null })
  replacedBySessionId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  ipAddress: string | null;

  @Prop({ type: String, default: null })
  userAgent: string | null;
}

export const AuthSessionSchema = SchemaFactory.createForClass(AuthSession);

AuthSessionSchema.index({ refreshTokenHash: 1 }, { unique: true });
AuthSessionSchema.index({ userId: 1, revokedAt: 1 });
AuthSessionSchema.index({ familyId: 1 });
AuthSessionSchema.index({ usedRefreshTokenHashes: 1 });
// Cleanup is asynchronous: authentication must also check expiresAt explicitly.
AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
