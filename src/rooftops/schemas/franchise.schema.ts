import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FranchiseDocument = Franchise & Document;

/**
 * Franchise represents a brand / marque operating at a specific rooftop.
 * One rooftop can carry multiple franchises (e.g. Toyota + Lexus at Dandenong).
 * The brand register is scoped by rooftopId so every other module can filter
 * inventory, orders, and pricing by brand within a precinct.
 */
@Schema({ timestamps: true })
export class Franchise {
  /**
   * The parent rooftop's slug — mirrors User.rooftopId convention.
   * e.g. "ROOFTOP-DANDENONG"
   */
  @Prop({ required: true, index: true })
  rooftopId: string;

  /**
   * OEM brand code — upper-case short code as used by Pentana and OEM feeds.
   * e.g. "TOYOTA", "LEXUS", "HINO"
   */
  @Prop({ required: true })
  brandCode: string;

  /** Full display name of the brand */
  @Prop({ required: true })
  brandName: string;

  /**
   * OEM parts catalogue endpoint or identifier used when routing part
   * lookup requests to the correct OEM feed for this franchise.
   */
  @Prop({ type: String, default: null })
  oemFeedEndpoint: string | null;

  /**
   * Pentana franchise code specific to this rooftop+brand combination.
   * Used to scope Pentana DMS queries to the correct franchise ledger.
   */
  @Prop({ type: String, default: null })
  pentanaFranchiseCode: string | null;

  @Prop({ default: true })
  isActive: boolean;
}

export const FranchiseSchema = SchemaFactory.createForClass(Franchise);

// Compound unique: one brand per rooftop
FranchiseSchema.index({ rooftopId: 1, brandCode: 1 }, { unique: true });
FranchiseSchema.index({ isActive: 1 });
