import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PartDocument = Part & Document;

/**
 * Part represents a single entry in the shared parts catalogue.
 * Records are sourced from OEM feeds and Pentana DMS syncs.
 * The catalogue is franchise-scoped: one Part document per partNumber +
 * brandCode combination (enforced by a compound unique index).
 *
 * The search index covers partNumber, description, and keywords so that a
 * single query string can match against all three fields.
 */
@Schema({ timestamps: true })
export class Part {
  // ─── Identity ─────────────────────────────────────────────────────────────

  /**
   * OEM / Pentana part number — the canonical external identifier.
   * e.g. "04465-0D060", "ME013026"
   * Stored exactly as received (mixed-case preserved, hyphens retained).
   */
  @Prop({ required: true })
  partNumber: string;

  /**
   * Normalised part number — upper-case, hyphens stripped — used for
   * case-insensitive search matching.
   * e.g. "044650D060", "ME013026"
   */
  @Prop({ required: true, index: true })
  partNumberNormalised: string;

  /**
   * OEM brand code the part belongs to — must match a Franchise.brandCode.
   * e.g. "TOYOTA", "MITSUBISHI"
   */
  @Prop({ required: true, index: true })
  brandCode: string;

  // ─── Description & classification ─────────────────────────────────────────

  /** Human-readable part description as supplied by the OEM feed */
  @Prop({ required: true })
  description: string;

  /**
   * Optional secondary description / long description from the OEM feed.
   * Some feeds provide a richer narrative alongside the short description.
   */
  @Prop({ type: String, default: null })
  descriptionLong: string | null;

  /**
   * OEM product group / category code — e.g. "BRAKE", "FILTER", "ENGINE_SEAL"
   * Used for category-level filtering in the search panel.
   */
  @Prop({ type: String, default: null })
  groupCode: string | null;

  /** Display label for the group — e.g. "Brakes & Clutch" */
  @Prop({ type: String, default: null })
  groupName: string | null;

  /**
   * Normalised keyword array built at import time from partNumber tokens,
   * description words, and any OEM synonym codes. Stored lower-case for
   * fast `$in` / text-search matching.
   */
  @Prop({ type: [String], default: [] })
  keywords: string[];

  // ─── Vehicle fitment ──────────────────────────────────────────────────────

  /**
   * Array of vehicle model strings this part fits — each entry is the
   * normalised form of a model code from the OEM fitment data.
   * e.g. ["COROLLA", "YARIS", "CAMRY"]
   * Stored lower-case for case-insensitive $in matching.
   */
  @Prop({ type: [String], default: [] })
  vehicleFitment: string[];

  /**
   * Free-text vehicle filter hint — human-readable range string from the
   * OEM catalogue for display purposes.
   * e.g. "Corolla 2018–2023 (ZRE172R)"
   */
  @Prop({ type: String, default: null })
  vehicleRange: string | null;

  // ─── Pricing ──────────────────────────────────────────────────────────────

  /**
   * OEM recommended list price in AUD cents.
   * Integer cents to avoid float precision issues.
   * Null when the price feed has not provided a value.
   */
  @Prop({ type: Number, default: null })
  listPriceCents: number | null;

  /**
   * Core / deposit charge in AUD cents (applicable to exchange units).
   * Null when not applicable.
   */
  @Prop({ type: Number, default: null })
  coreChargeCents: number | null;

  // ─── Catalogue metadata ───────────────────────────────────────────────────

  /**
   * Whether this part is currently active in the OEM feed.
   * Superseded or discontinued parts are set to false but retained for
   * historical order reference.
   */
  @Prop({ default: true })
  isActive: boolean;

  /**
   * Whether the OEM has flagged this part as superseded.
   * If true, supersededByPartNumber should be populated.
   */
  @Prop({ default: false })
  isSuperseded: boolean;

  /** Replacement part number when isSuperseded is true */
  @Prop({ type: String, default: null })
  supersededByPartNumber: string | null;

  /**
   * Unit of measure for ordering — e.g. "EACH", "LITRE", "METRE", "PAIR"
   * Defaults to "EACH".
   */
  @Prop({ type: String, default: 'EACH' })
  unitOfMeasure: string;

  /** Last time this catalogue record was synced from the OEM / Pentana feed */
  @Prop({ type: Date, default: null })
  lastSyncedAt: Date | null;
}

export const PartSchema = SchemaFactory.createForClass(Part);

// ─── Indexes ────────────────────────────────────────────────────────────────

// Compound unique: one catalogue entry per OEM part number + brand
PartSchema.index({ partNumber: 1, brandCode: 1 }, { unique: true });

// Text search index — covers part number, description, and keywords
PartSchema.index(
  { partNumberNormalised: 'text', description: 'text', keywords: 'text' },
  { name: 'parts_text_search', weights: { partNumberNormalised: 10, description: 5, keywords: 1 } },
);

// Vehicle fitment filter
PartSchema.index({ vehicleFitment: 1 });

// Catalogue health / active filter
PartSchema.index({ isActive: 1 });
PartSchema.index({ brandCode: 1, isActive: 1 });
