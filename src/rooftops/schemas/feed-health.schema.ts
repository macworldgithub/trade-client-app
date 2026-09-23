import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FeedHealthDocument = FeedHealth & Document;

export enum FeedStatus {
  OK = 'ok',
  DEGRADED = 'degraded',
  DOWN = 'down',
  UNKNOWN = 'unknown',
}

export enum FeedType {
  PENTANA = 'pentana',
  OEM = 'oem',
}

/**
 * FeedHealth records the most recent connectivity / sync status for each
 * data feed (Pentana DMS and OEM catalogues) at a given rooftop.
 * One document per rooftopId + feedType + brandCode combination.
 * Polled/updated by a scheduled job; the GET /rooftops/:id/feed-health
 * endpoint returns the latest snapshot for each feed at that precinct.
 */
@Schema({ timestamps: true })
export class FeedHealth {
  /** Parent rooftop slug — e.g. "ROOFTOP-DANDENONG" */
  @Prop({ required: true, index: true })
  rooftopId: string;

  /** Whether this is the Pentana DMS feed or an OEM catalogue feed */
  @Prop({ type: String, enum: FeedType, required: true })
  feedType: FeedType;

  /**
   * For OEM feeds: the brand code this record belongs to.
   * For Pentana feeds: null (one Pentana connection per rooftop).
   */
  @Prop({ type: String, default: null })
  brandCode: string | null;

  /** Current health status of the feed */
  @Prop({ type: String, enum: FeedStatus, default: FeedStatus.UNKNOWN })
  status: FeedStatus;

  /** UTC timestamp of the last successful data sync */
  @Prop({ type: Date, default: null })
  lastSyncAt: Date | null;

  /** UTC timestamp of the last health check attempt */
  @Prop({ type: Date, default: null })
  lastCheckedAt: Date | null;

  /** Human-readable message from the most recent check — e.g. error detail */
  @Prop({ type: String, default: null })
  message: string | null;

  /** Response time in milliseconds from the most recent probe */
  @Prop({ type: Number, default: null })
  latencyMs: number | null;
}

export const FeedHealthSchema = SchemaFactory.createForClass(FeedHealth);

// Compound unique: one feed-health record per rooftop + feed type + brand
FeedHealthSchema.index(
  { rooftopId: 1, feedType: 1, brandCode: 1 },
  { unique: true },
);
