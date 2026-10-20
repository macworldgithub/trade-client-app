import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { User } from './user.schema';

export type MfaChallengeDocument = HydratedDocument<MfaChallenge>;

@Schema({ timestamps: true, versionKey: false })
export class MfaChallenge {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  @Prop({ type: Number, required: true })
  passwordVersion: number;

  @Prop({ type: Number, required: true })
  mfaVersion: number;

  @Prop({ type: Number, default: 0 })
  attempts: number;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  consumedAt: Date | null;
}

export const MfaChallengeSchema = SchemaFactory.createForClass(MfaChallenge);
MfaChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
