import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RooftopDocument = Rooftop & Document;

/**
 * Rooftop represents a physical dealership precinct (one of the 9 precincts
 * across 24 addresses operated by Booran Motor Group). Every other module
 * scopes its data to a selected rooftop via rooftopId.
 */
@Schema({ timestamps: true })
export class Rooftop {
  /**
   * Human-readable slug used as the canonical external ID that links to
   * Pentana and is stored on User.rooftopId.
   * e.g. "ROOFTOP-DANDENONG"
   */
  @Prop({ required: true, unique: true })
  rooftopId: string;

  /** Display name of the precinct */
  @Prop({ required: true })
  name: string;

  /** Short code used in reporting — e.g. "DAN", "FTG" */
  @Prop({ required: true, unique: true })
  code: string;

  // ─── Location ────────────────────────────────────────────────────────────

  @Prop({ required: true })
  address: string;

  @Prop({ required: true })
  suburb: string;

  @Prop({ required: true })
  state: string;

  @Prop({ required: true })
  postcode: string;

  /** e.g. "+61 3 9793 9999" */
  @Prop({ type: String, default: null })
  phone: string | null;

  // ─── Operational ─────────────────────────────────────────────────────────

  /**
   * Pentana DMS site code — used when constructing API calls to the
   * Pentana Connect feed for this precinct.
   */
  @Prop({ type: String, default: null })
  pentanaSiteCode: string | null;

  /** Comma-separated list of OEM brand codes active at this precinct */
  @Prop({ type: [String], default: [] })
  oemBrandCodes: string[];

  @Prop({ default: true })
  isActive: boolean;

  /** UTC offset for local trading-hours display — e.g. "+10:00" */
  @Prop({ type: String, default: '+10:00' })
  timezone: string;
}

export const RooftopSchema = SchemaFactory.createForClass(Rooftop);

// Fast lookups by slug / active flag
RooftopSchema.index({ rooftopId: 1 });
RooftopSchema.index({ isActive: 1 });
