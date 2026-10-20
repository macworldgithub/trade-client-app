import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuthRateLimitDocument = HydratedDocument<AuthRateLimit>;

@Schema({ versionKey: false })
export class AuthRateLimit {
  // HMAC of the policy, identity, and window: no raw email or IP is stored.
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: Number, required: true })
  count: number;

  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export const AuthRateLimitSchema = SchemaFactory.createForClass(AuthRateLimit);
AuthRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
