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
