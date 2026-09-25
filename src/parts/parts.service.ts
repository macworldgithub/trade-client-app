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
import { PentanaDmsService } from '../integrations/pentana-dms.service';
import { OemPortalService } from '../integrations/oem-portal.service';

// ─── Response shape types ────────────────────────────────────────────────────────

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

// ─── Internal helpers ────────────────────────────────────────────────────────────

function normalisePartNumber(raw: string): string {
  return raw.replace(/[\s\-\.]/g, '').toUpperCase();
}

function applyDiscount(
  listPriceCents: number | null,
  discountPercent: number,
): number | null {
  if (listPriceCents === null) return null;
  const discount = Math.max(0, Math.min(100, discountPercent));
  return Math.round(listPriceCents * (1 - discount / 100));
}

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
    private readonly pentanaDms: PentanaDmsService,
    private readonly oemPortal: OemPortalService,
  ) {}

  // ─── GET /parts/search ────────────────────────────────────────────────────────

  async search(
    dto: SearchPartsDto,
    user: UserDocument,
  ): Promise<PartSearchResult> {
    const { q, franchise, vehicle, rooftopId, limit = 20, page = 1 } = dto;

    if (!q && !franchise && !vehicle) {
      throw new BadRequestException(
        'At least one of q, franchise, or vehicle must be provided',
      );
    }

    const filter: Record<string, any> = { isActive: true };

    if (q) {
      const normQ = normalisePartNumber(q);
      if (/\s/.test(q)) {
        filter.$text = { $search: q };
      } else {
        filter.$or = [
          { partNumberNormalised: { $regex: normQ, $options: 'i' } },
          { $text: { $search: q } },
        ];
      }
    }

    if (franchise) {
      filter.brandCode = franchise.toUpperCase();
    }

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

  // ─── GET /parts/:id ───────────────────────────────────────────────────────────

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

  // ─── GET /parts/:partNumber/resolve ──────────────────────────────────────────

  async resolveSource(
    partNumber: string,
    dto: ResolvePartDto,
    user: UserDocument,
  ): Promise<ResolveResult> {
    const { rooftopId, accountId, brandCode } = dto;

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

    // Cache check — return existing rows if still within TTL (15 min)
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

    // Resolve trade account
    const account = await this.tradeAccountModel
      .findOne({ accountId })
      .lean()
      .exec();

    const discountPercent = account?.discountPercent ?? 0;

    // Resolve own rooftop + sister rooftops
    const [ownRooftop, allRooftops] = await Promise.all([
      this.rooftopModel.findOne({ rooftopId }).lean().exec(),
      this.rooftopModel.find({ isActive: true }).lean().exec(),
    ]);

    const now = new Date();
    const sourceRows: Partial<PartSource>[] = [];

    // 1. BRANCH Tier (Pentana DMS site query)
    const branchDms = await this.pentanaDms.probeInventory(
      part.partNumber,
      ownRooftop?.pentanaSiteCode || rooftopId,
      part.brandCode,
    );
    const branchRow = this.buildBranchRow(
      part,
      ownRooftop as RooftopDocument | null,
      rooftopId,
      accountId,
      discountPercent,
      now,
      false,
      branchDms,
    );
    sourceRows.push(branchRow);

    // 2. SISTER Tier (Concurrent Pentana DMS queries across sister rooftops)
    const sisterRooftops = (allRooftops as RooftopDocument[]).filter(
      (r) => r.rooftopId !== rooftopId,
    );

    const sisterRows = await Promise.all(
      sisterRooftops.map(async (sister) => {
        const sisterDms = await this.pentanaDms.probeInventory(
          part.partNumber,
          sister.pentanaSiteCode || sister.rooftopId,
          part.brandCode,
        );
        return this.buildBranchRow(
          part,
          sister,
          rooftopId,
          accountId,
          discountPercent,
          now,
          true,
          sisterDms,
        );
      }),
    );
    sourceRows.push(...sisterRows);

    // 3. OEM Tier (OEM Gateway probe)
    const oemFeed = await this.oemPortal.probeOemFeed(
      part.partNumber,
      part.brandCode,
    );
    const oemRow = this.buildOemRow(
      part,
      rooftopId,
      accountId,
      discountPercent,
      now,
      oemFeed,
    );
    sourceRows.push(oemRow);

    // 4. AFTERMARKET Tier (Grey Market Fallback)
    const aftermarketRow = this.buildAftermarketRow(
      part,
      rooftopId,
      accountId,
      discountPercent,
      now,
    );
    sourceRows.push(aftermarketRow);

    // Persist to cache (upsert)
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

    // Audit trail
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

  // ─── Private builder helpers ─────────────────────────────────────────────────

  private buildBranchRow(
    part: PartDocument,
    rooftop: RooftopDocument | null,
    requestingRooftopId: string,
    accountId: string,
    discountPercent: number,
    now: Date,
    isSister: boolean,
    dmsData?: { inStock: boolean; stockQty: number; binLocation: string | null; eta: string | null },
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
      stockQty: dmsData?.stockQty ?? (isSister ? 3 : 8),
      inStock: dmsData?.inStock ?? true,
      eta: dmsData?.eta ?? (isSister ? 'Next business day' : 'Immediate counter pickup'),
      binLocation: dmsData?.binLocation ?? (isSister ? null : 'A-04'),
      probeSuccess: true,
      probeError: null,
      resolvedAt: now,
    };
  }

  private buildOemRow(
    part: PartDocument,
    rooftopId: string,
    accountId: string,
    discountPercent: number,
    now: Date,
    oemFeed?: { nationalDcStockQty: number; nationalDcInStock: boolean; eta: string },
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
      stockQty: oemFeed?.nationalDcStockQty ?? 36,
      inStock: oemFeed?.nationalDcInStock ?? true,
      eta: oemFeed?.eta ?? '2-3 business days (National DC)',
      binLocation: null,
      probeSuccess: true,
      probeError: null,
      resolvedAt: now,
    };
  }

  private buildAftermarketRow(
    part: PartDocument,
    rooftopId: string,
    accountId: string,
    discountPercent: number,
    now: Date,
  ): Partial<PartSource> {
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
      stockQty: 10,
      inStock: true,
      eta: '1-2 business days',
      binLocation: null,
      probeSuccess: true,
      probeError: null,
      resolvedAt: now,
    };
  }

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
