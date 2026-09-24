import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PartSourceDocument = PartSource & Document;

/**
 * The four source kinds produced by federated resolution, in priority order:
 *
 *   BRANCH      — own-branch stock (same rooftopId as the requesting user)
 *   SISTER      — sister-branch stock (different rooftop, same motor group)
 *   OEM         — live OEM parts portal (ordered direct from manufacturer)
 *   AFTERMARKET — grey / aftermarket supplier
 *
 * The resolver walks sources in this order and returns all available rows so
 * the trade partner can compare price, stock, and ETA before adding to basket.
 */
export enum SourceKind {
  BRANCH = 'BRANCH',
  SISTER = 'SISTER',
  OEM = 'OEM',
  AFTERMARKET = 'AFTERMARKET',
}

/**
 * PartSource represents one resolved sourcing option for a given part number
 * at a given rooftop + account combination.
 *
 * Documents are written by the federated resolver and are short-lived cache
 * entries — they expire after 15 minutes (TTL index) to force a fresh probe
 * on the next resolve call.
 *
 * One document per partNumber + rooftopId + sourceKind + sourceName.
 */
@Schema({ timestamps: true })
export class PartSource {
  // ─── Part identity ────────────────────────────────────────────────────────

  /**
   * The OEM part number this source row belongs to.
   * Matches Part.partNumber exactly (case-preserved).
   */
  @Prop({ required: true, index: true })
  partNumber: string;

  /**
   * OEM brand code — matches Part.brandCode and Franchise.brandCode.
   * e.g. "TOYOTA", "MITSUBISHI"
   */
  @Prop({ required: true })
  brandCode: string;

  // ─── Resolution context ───────────────────────────────────────────────────

  /**
   * The rooftop the resolution was performed for.
   * Own-branch rows carry the same rooftopId; sister-branch rows carry the
   * sister rooftop's id in sourceName / sourceRooftopId.
   */
  @Prop({ required: true, index: true })
  rooftopId: string;

  /**
   * The trade account the resolution was scoped to.
   * Needed because trade price may vary by account discount tier.
   */
  @Prop({ required: true })
  accountId: string;

  // ─── Source descriptor ────────────────────────────────────────────────────

  /**
   * Which tier of the federated waterfall this row came from.
   * Controls sort order and UI badge on the front-end.
   */
  @Prop({ type: String, enum: SourceKind, required: true })
  sourceKind: SourceKind;

  /**
   * Human-readable name for the specific source within the kind tier.
   * For BRANCH / SISTER: the rooftop display name e.g. "Dandenong Parts"
   * For OEM: the OEM portal name e.g. "Toyota Parts Exchange"
   * For AFTERMARKET: the supplier name e.g. "Repco", "Capricorn"
   */
  @Prop({ required: true })
  sourceName: string;

  /**
   * For BRANCH / SISTER rows: the rooftopId of the supplying branch.
   * Null for OEM and AFTERMARKET rows.
   */
  @Prop({ type: String, default: null })
  sourceRooftopId: string | null;

  // ─── Pricing ──────────────────────────────────────────────────────────────

  /**
   * OEM recommended list price in AUD cents as quoted by this source.
   * Integer cents to avoid float precision issues. Null if not provided.
   */
  @Prop({ type: Number, default: null })
  listPriceCents: number | null;

  /**
   * Trade price in AUD cents after account-level discount is applied.
   * This is the price that will be used at basket / order time.
   * Null if the source could not determine a trade price.
   */
  @Prop({ type: Number, default: null })
  tradePriceCents: number | null;

  /**
   * Core / exchange deposit in AUD cents, if applicable.
   * Added on top of trade price for exchange units (e.g. alternators, starters).
   */
  @Prop({ type: Number, default: null })
  coreChargeCents: number | null;

  // ─── Availability ─────────────────────────────────────────────────────────

  /**
   * Quantity on hand at this source location.
   * Null when the source does not expose live stock (e.g. some OEM portals
   * return availability as a flag rather than a quantity).
   */
  @Prop({ type: Number, default: null })
  stockQty: number | null;

  /**
   * Whether stock is confirmed available at this source regardless of qty.
   * Primarily for OEM / aftermarket sources that only return a binary flag.
   */
  @Prop({ default: false })
  inStock: boolean;

  /**
   * Estimated time of arrival at the requesting rooftop, as an ISO-8601
   * datetime string or a human-readable label from the source.
   * e.g. "2026-09-25T10:00:00+10:00", "Same day", "Next business day"
   * Null when the source cannot provide an ETA.
   */
  @Prop({ type: String, default: null })
  eta: string | null;

  // ─── Bin location ─────────────────────────────────────────────────────────

  /**
   * Physical bin / shelf location at the source branch warehouse.
   * Only populated for BRANCH and SISTER rows.
   * e.g. "A-12-03", "SHELF-B7"
   */
  @Prop({ type: String, default: null })
  binLocation: string | null;

  // ─── Metadata ─────────────────────────────────────────────────────────────

  /**
   * Whether this source row was successfully fetched (true) or the probe
   * failed / timed out (false). Failed rows are still persisted so the
   * resolver can report partial degradation to the caller.
   */
  @Prop({ default: true })
  probeSuccess: boolean;

  /**
   * Error message from a failed probe — null when probeSuccess is true.
   */
  @Prop({ type: String, default: null })
  probeError: string | null;

  /**
   * UTC timestamp when the resolver fetched this row from its upstream source.
   * Used for cache staleness checks and display ("last checked Xs ago").
   */
  @Prop({ type: Date, required: true })
  resolvedAt: Date;
}

export const PartSourceSchema = SchemaFactory.createForClass(PartSource);

// ─── Indexes ────────────────────────────────────────────────────────────────

// Primary lookup: all sources for a given part at a given rooftop + account
PartSourceSchema.index({ partNumber: 1, rooftopId: 1, accountId: 1 });

// Compound unique: one row per part + rooftop + account + kind + source name
PartSourceSchema.index(
  { partNumber: 1, rooftopId: 1, accountId: 1, sourceKind: 1, sourceName: 1 },
  { unique: true },
);

// TTL: expire cached resolution rows after 15 minutes (900 seconds)
PartSourceSchema.index(
  { resolvedAt: 1 },
  { expireAfterSeconds: 900, name: 'part_source_ttl' },
);
