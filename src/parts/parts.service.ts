import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Part, PartDocument } from './schemas/part.schema';
import {
  PartSource,
  PartSourceDocument,
  SourceKind,
} from './schemas/part-source.schema';
import { Rooftop, RooftopDocument } from '../rooftops/schemas/rooftop.schema';
import {
  TradeAccount,
  TradeAccountDocument,
} from '../accounts/schemas/account.schema';
import {
  AuditEvent,
  AuditEventDocument,
  AuditAction,
} from '../auth/schemas/audit-event.schema';
import { UserDocument } from '../auth/schemas/user.schema';
import { SearchPartsDto } from './dto/search-parts.dto';
import { ResolvePartDto } from './dto/resolve-part.dto';

// ─── Response shape types ────────────────────────────────────────────────────

export interface PartSearchResult {
  total: number;
  page: number;
  limit: number;
  results: PartDocument[];
}

export interface SourceRow {
  sourceKind: SourceKind;
  sourceName: string;
  sourceRooftopId: string | null;
  listPriceCents: number | null;
  tradePriceCents: number | null;
  coreChargeCents: number | null;
  stockQty: number | null;
  inStock: boolean;
  eta: string | null;
  binLocation: string | null;
  probeSuccess: boolean;
  probeError: string | null;
  resolvedAt: Date;
}

export interface ResolveResult {
  partNumber: string;
  brandCode: string;
  rooftopId: string;
  accountId: string;
  sources: SourceRow[];
  cachedAt: Date | null;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Strip hyphens, spaces, and dots then upper-case a part number so that
 * "04465-0D060", "044650D060", and "04465 0D060" all match the same index key.
 */
function normalisePartNumber(raw: string): string {
  return raw.replace(/[\s\-\.]/g, '').toUpperCase();
}

/**
 * Apply an account's discount percentage to a list price in cents.
 * Returns null when either input is null / zero.
 */
function applyDiscount(
  listPriceCents: number | null,
  discountPercent: number,
): number | null {
  if (listPriceCents === null) return null;
  const discount = Math.max(0, Math.min(100, discountPercent));
  return Math.round(listPriceCents * (1 - discount / 100));
}

// ─── Sort order for federated source kinds ───────────────────────────────────

const SOURCE_KIND_ORDER: Record<SourceKind, number> = {
  [SourceKind.BRANCH]: 0,
  [SourceKind.SISTER]: 1,
  [SourceKind.OEM]: 2,
  [SourceKind.AFTERMARKET]: 3,
};

@Injectable()
export class PartsService {
  constructor(
    @InjectModel(Part.name) private partModel: Model<PartDocument>,
    @InjectModel(PartSource.name)
    private partSourceModel: Model<PartSourceDocument>,
    @InjectModel(Rooftop.name) private rooftopModel: Model<RooftopDocument>,
    @InjectModel(TradeAccount.name)
    private tradeAccountModel: Model<TradeAccountDocument>,
    @InjectModel(AuditEvent.name)
    private auditEventModel: Model<AuditEventDocument>,
  ) {}

  // ─── GET /parts/search ──────────────────────────────────────────────────

  /**
   * Catalogue search across partNumber, description, and keywords.
   * Supports three independent filter axes — text query, franchise/brand,
   * and vehicle fitment — that can be combined freely.
   *
   * At least one of q, franchise, or vehicle must be provided.
   *
   * Writes a SEARCH audit event scoped to the calling user and rooftop.
   */
  async search(
    dto: SearchPartsDto,
    user: UserDocument,
  ): Promise<PartSearchResult> {
    const { q, franchise, vehicle, rooftopId, limit = 20, page = 1 } = dto;

    // Require at least one meaningful filter
    if (!q && !franchise && !vehicle) {
      throw new BadRequestException(
        'At least one of q, franchise, or vehicle must be provided',
      );
    }

    const filter: Record<string, any> = { isActive: true };

    // ── Text / part-number search ──────────────────────────────────────────
    if (q) {
      const normQ = normalisePartNumber(q);
      // Try exact normalised part-number match first; fall back to $text search
      // if the query contains spaces or looks like a keyword phrase.
      if (/\s/.test(q)) {
        // Multi-word phrase → full-text index
        filter.$text = { $search: q };
      } else {
        // Could be a part number or single keyword — cover both:
        filter.$or = [
          { partNumberNormalised: { $regex: normQ, $options: 'i' } },
          { $text: { $search: q } },
        ];
      }
    }

    // ── Franchise / brand filter ───────────────────────────────────────────
    if (franchise) {
      filter.brandCode = franchise.toUpperCase();
    }

    // ── Vehicle fitment filter ─────────────────────────────────────────────
    if (vehicle) {
      filter.vehicleFitment = vehicle.toUpperCase();
    }

    const skip = (page - 1) * limit;

    const [total, results] = await Promise.all([
      this.partModel.countDocuments(filter).exec(),
      this.partModel
        .find(filter)
        .sort(q ? { score: { $meta: 'textScore' } } : { partNumber: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    // ── Audit trail ───────────────────────────────────────────────────────
    await this.auditEventModel.create({
      action: AuditAction.SEARCH,
      userId: user.supabaseId,
      tradeAccountId: user.tradeAccountId,
      rooftopId: rooftopId ?? user.rooftopId ?? null,
      metadata: { q, franchise, vehicle, rooftopId, total },
      ipAddress: null,
    });

    return { total, page, limit, results: results as PartDocument[] };
  }

  // ─── GET /parts/:id ─────────────────────────────────────────────────────

  /**
   * Fetch a single part by its MongoDB _id or by its OEM partNumber.
   * Accepts either a 24-character hex Mongo ObjectId or a raw OEM part number.
   */
  async findOne(id: string): Promise<PartDocument> {
    const isObjectId = /^[a-f\d]{24}$/i.test(id);

    const part = await (isObjectId
      ? this.partModel.findById(id).lean().exec()
      : this.partModel
          .findOne({
            partNumberNormalised: normalisePartNumber(id),
            isActive: true,
          })
          .lean()
          .exec());

    if (!part) {
      throw new NotFoundException(`Part '${id}' not found`);
    }

    return part as PartDocument;
  }

  // ─── GET /parts/:partNumber/resolve ─────────────────────────────────────

  /**
   * Federated source resolution for a given part number.
   *
   * Resolution waterfall (in priority order):
   *   1. BRANCH   — own-branch stock at rooftopId (bin location + live qty)
   *   2. SISTER   — sister branches in the motor group (other active rooftops)
   *   3. OEM      — OEM parts portal for each franchise at the rooftop
   *   4. AFTERMARKET — grey / aftermarket fallback placeholder
   *
   * Each tier is probed concurrently within the tier. Results from all tiers
   * are returned so the trade partner can compare options.
   *
   * Cache strategy: if unexpired PartSource documents already exist for this
   * partNumber + rooftopId + accountId combination, they are returned
   * immediately without re-probing (TTL is 15 minutes per PartSource schema).
   *
   * Writes a SOURCE_RESOLVE audit event.
   */
  async resolveSource(
    partNumber: string,
    dto: ResolvePartDto,
    user: UserDocument,
  ): Promise<ResolveResult> {
    const { rooftopId, accountId, brandCode } = dto;

    // ── Validate the part exists ───────────────────────────────────────────
    const normPartNumber = normalisePartNumber(partNumber);
    const partFilter: Record<string, any> = {
      partNumberNormalised: normPartNumber,
    };
    if (brandCode) {
      partFilter.brandCode = brandCode.toUpperCase();
    }

    const part = await this.partModel.findOne(partFilter).lean().exec();
    if (!part) {
      throw new NotFoundException(
        `Part '${partNumber}' not found in catalogue`,
      );
    }

    // ── Cache check — return existing rows if still within TTL ─────────────
    const cached = await this.partSourceModel
      .find({ partNumber: part.partNumber, rooftopId, accountId })
      .lean()
      .exec();

    if (cached.length > 0) {
      const sources = this.sortSources(cached as PartSourceDocument[]);
      return {
        partNumber: part.partNumber,
        brandCode: part.brandCode,
        rooftopId,
        accountId,
        sources,
        cachedAt: (cached[0] as any).resolvedAt ?? null,
      };
    }

    // ── Resolve account for trade price calculation ────────────────────────
    const account = await this.tradeAccountModel
      .findOne({ accountId })
      .lean()
      .exec();

    const discountPercent = account?.discountPercent ?? 0;

    // ── Resolve rooftop + all active rooftops for sister-branch ───────────
    const [ownRooftop, allRooftops] = await Promise.all([
      this.rooftopModel.findOne({ rooftopId }).lean().exec(),
      this.rooftopModel.find({ isActive: true }).lean().exec(),
    ]);

    const now = new Date();
    const sourceRows: Partial<PartSource>[] = [];

    // ── Tier 1: BRANCH — own rooftop ──────────────────────────────────────
    const branchRow = this.buildBranchRow(
      part,
      ownRooftop as RooftopDocument | null,
      rooftopId,
      accountId,
      discountPercent,
      now,
      false, // is own branch
    );
    sourceRows.push(branchRow);

    // ── Tier 2: SISTER — other active rooftops ────────────────────────────
    const sisterRooftops = (allRooftops as RooftopDocument[]).filter(
      (r) => r.rooftopId !== rooftopId,
    );

    const sisterRows = sisterRooftops.map((sister) =>
      this.buildBranchRow(
        part,
        sister,
        rooftopId,
        accountId,
        discountPercent,
        now,
        true, // is sister branch
      ),
    );
    sourceRows.push(...sisterRows);

    // ── Tier 3: OEM — franchise feed(s) at own rooftop ───────────────────
    const oemRow = this.buildOemRow(
      part,
      rooftopId,
      accountId,
      discountPercent,
      now,
    );
    sourceRows.push(oemRow);

    // ── Tier 4: AFTERMARKET — grey market placeholder ─────────────────────
    const aftermarketRow = this.buildAftermarketRow(
      part,
      rooftopId,
      accountId,
      discountPercent,
      now,
    );
    sourceRows.push(aftermarketRow);

    // ── Persist to cache (upsert to handle concurrent requests) ───────────
    await Promise.all(
      sourceRows.map((row) =>
        this.partSourceModel
          .findOneAndUpdate(
            {
              partNumber: row.partNumber,
              rooftopId: row.rooftopId,
              accountId: row.accountId,
              sourceKind: row.sourceKind,
              sourceName: row.sourceName,
            },
            { $set: row },
            { upsert: true, new: true },
          )
          .exec(),
      ),
    );

    // ── Audit trail ───────────────────────────────────────────────────────
    await this.auditEventModel.create({
      action: AuditAction.SOURCE_RESOLVE,
      userId: user.supabaseId,
      tradeAccountId: user.tradeAccountId,
      rooftopId,
      metadata: {
        partNumber: part.partNumber,
        brandCode: part.brandCode,
        accountId,
        sourceCount: sourceRows.length,
      },
      ipAddress: null,
    });

    const sources = this.sortSources(sourceRows as PartSourceDocument[]);

    return {
      partNumber: part.partNumber,
      brandCode: part.brandCode,
      rooftopId,
      accountId,
      sources,
      cachedAt: null,
    };
  }

  // ─── Private builder helpers ─────────────────────────────────────────────

  /**
   * Build a BRANCH or SISTER source row.
   *
   * In production these values would come from a live Pentana DMS query
   * (stock qty, bin location) scoped by pentanaSiteCode + pentanaFranchiseCode.
   * The current implementation returns a realistic stub that the integration
   * layer can replace by overriding these fields after the DMS call.
   *
   * Stub behaviour:
   *   - stockQty: null (unknown until DMS query)
   *   - inStock: false
   *   - binLocation: null
   *   - eta: "Next business day" for sister, null for own branch
   *   - probeSuccess: true (the DMS probe is assumed healthy; set false on timeout)
   */
  private buildBranchRow(
    part: PartDocument,
    rooftop: RooftopDocument | null,
    requestingRooftopId: string,
    accountId: string,
    discountPercent: number,
    now: Date,
    isSister: boolean,
  ): Partial<PartSource> {
    const tradePriceCents = applyDiscount(part.listPriceCents, discountPercent);

    return {
      partNumber: part.partNumber,
      brandCode: part.brandCode,
      rooftopId: requestingRooftopId,
      accountId,
      sourceKind: isSister ? SourceKind.SISTER : SourceKind.BRANCH,
      sourceName: rooftop
        ? `${rooftop.name} Parts`
        : isSister
          ? 'Sister Branch'
          : 'Own Branch',
      sourceRooftopId: rooftop?.rooftopId ?? null,
      listPriceCents: part.listPriceCents,
      tradePriceCents,
      coreChargeCents: part.coreChargeCents,
      stockQty: null,      // populated by DMS integration layer
      inStock: false,      // populated by DMS integration layer
      eta: isSister ? 'Next business day' : null,
      binLocation: null,   // populated by DMS integration layer
      probeSuccess: true,
      probeError: null,
      resolvedAt: now,
    };
  }

  /**
   * Build an OEM source row.
   *
   * In production this would call the OEM parts portal (endpoint from
   * Franchise.oemFeedEndpoint) to get live stock and ETA.
   * Returns a stub with list/trade pricing populated from the catalogue.
   */
  private buildOemRow(
    part: PartDocument,
    rooftopId: string,
    accountId: string,
    discountPercent: number,
    now: Date,
  ): Partial<PartSource> {
    const tradePriceCents = applyDiscount(part.listPriceCents, discountPercent);

    return {
      partNumber: part.partNumber,
      brandCode: part.brandCode,
      rooftopId,
      accountId,
      sourceKind: SourceKind.OEM,
      sourceName: `${part.brandCode} Parts Portal`,
      sourceRooftopId: null,
      listPriceCents: part.listPriceCents,
      tradePriceCents,
      coreChargeCents: part.coreChargeCents,
      stockQty: null,
      inStock: false,
      eta: '3–5 business days',
      binLocation: null,
      probeSuccess: true,
      probeError: null,
      resolvedAt: now,
    };
  }

  /**
   * Build an AFTERMARKET source row.
   *
   * In production this would query a grey/aftermarket supplier API.
   * Returns a stub priced at 70 % of list (common aftermarket discount).
   */
  private buildAftermarketRow(
    part: PartDocument,
    rooftopId: string,
    accountId: string,
    discountPercent: number,
    now: Date,
  ): Partial<PartSource> {
    // Aftermarket list price is typically lower than OEM list price.
    // Stub: 70 % of OEM list, then apply account discount on top.
    const aftermarketListCents =
      part.listPriceCents !== null
        ? Math.round(part.listPriceCents * 0.7)
        : null;
    const tradePriceCents = applyDiscount(aftermarketListCents, discountPercent);

    return {
      partNumber: part.partNumber,
      brandCode: part.brandCode,
      rooftopId,
      accountId,
      sourceKind: SourceKind.AFTERMARKET,
      sourceName: 'Aftermarket Supplier',
      sourceRooftopId: null,
      listPriceCents: aftermarketListCents,
      tradePriceCents,
      coreChargeCents: null,
      stockQty: null,
      inStock: false,
      eta: '1–2 business days',
      binLocation: null,
      probeSuccess: true,
      probeError: null,
      resolvedAt: now,
    };
  }

  /**
   * Sort source rows by the canonical federation priority order:
   * BRANCH → SISTER → OEM → AFTERMARKET.
   * Within each tier, sort by sourceName for stable ordering.
   */
  private sortSources(rows: PartSourceDocument[]): SourceRow[] {
    return [...rows]
      .sort((a, b) => {
        const kindDiff =
          SOURCE_KIND_ORDER[a.sourceKind] - SOURCE_KIND_ORDER[b.sourceKind];
        if (kindDiff !== 0) return kindDiff;
        return a.sourceName.localeCompare(b.sourceName);
      })
      .map((r) => ({
        sourceKind: r.sourceKind,
        sourceName: r.sourceName,
        sourceRooftopId: r.sourceRooftopId,
        listPriceCents: r.listPriceCents,
        tradePriceCents: r.tradePriceCents,
        coreChargeCents: r.coreChargeCents,
        stockQty: r.stockQty,
        inStock: r.inStock,
        eta: r.eta,
        binLocation: r.binLocation,
        probeSuccess: r.probeSuccess,
        probeError: r.probeError,
        resolvedAt: r.resolvedAt,
      }));
  }
}
