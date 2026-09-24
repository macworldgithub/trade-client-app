import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { PartsService } from './parts.service';
import { SearchPartsDto } from './dto/search-parts.dto';
import { ResolvePartDto } from './dto/resolve-part.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserDocument } from '../auth/schemas/user.schema';

@ApiTags('Parts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('parts')
export class PartsController {
  constructor(private readonly partsService: PartsService) {}

  // ─── GET /parts/search ────────────────────────────────────────────────────

  /**
   * Single search-box endpoint for the parts catalogue.
   * Accepts a free-text query (OEM part number or keyword), an optional
   * franchise/brand filter, and an optional vehicle fitment filter.
   * Results are paginated; at least one of q, franchise, or vehicle is required.
   */
  @Get('search')
  @ApiOperation({
    summary: 'Search the parts catalogue',
    description:
      'Full-text search across OEM part numbers, descriptions, and keyword synonyms. ' +
      'Filter by franchise (brand code) and/or vehicle fitment. ' +
      'At least one of `q`, `franchise`, or `vehicle` must be supplied. ' +
      'Results are paginated — use `limit` and `page` to navigate.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'OEM part number or keyword phrase (min 2 chars)', example: '04465-0D060' })
  @ApiQuery({ name: 'franchise', required: false, description: 'OEM brand code — e.g. "TOYOTA"', example: 'TOYOTA' })
  @ApiQuery({ name: 'vehicle', required: false, description: 'Vehicle model — e.g. "COROLLA"', example: 'COROLLA' })
  @ApiQuery({ name: 'rooftopId', required: false, description: 'Rooftop context for audit scoping — e.g. "ROOFTOP-DANDENONG"', example: 'ROOFTOP-DANDENONG' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 20)', example: 20 })
  @ApiQuery({ name: 'page', required: false, description: '1-based page number (default 1)', example: 1 })
  @ApiResponse({
    status: 200,
    description: 'Paginated parts catalogue results — { total, page, limit, results[] }',
  })
  @ApiResponse({ status: 400, description: 'No search filter supplied or query too short' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  search(
    @Query() dto: SearchPartsDto,
    @CurrentUser() user: UserDocument,
  ) {
    return this.partsService.search(dto, user);
  }

  // ─── GET /parts/:partNumber/resolve ───────────────────────────────────────

  /**
   * Federated source resolution for a single part number.
   *
   * Walks the four-tier waterfall — own branch → sister branches → OEM portal
   * → aftermarket — and returns all available source rows so the trade partner
   * can compare price, stock on hand, ETA, and bin location before ordering.
   *
   * Results are cached for 15 minutes; a cached response includes cachedAt.
   *
   * IMPORTANT: this route is declared before /:id so that the literal path
   * segment "resolve" is never mistaken for a part id.
   */
  @Get(':partNumber/resolve')
  @ApiOperation({
    summary: 'Federated source resolution for a part',
    description:
      'Resolves all available sourcing options for the given OEM part number ' +
      'in priority order: own branch → sister branches → OEM portal → aftermarket. ' +
      'Each source row includes kind, list price, trade price, stock qty, ETA, and bin location. ' +
      'Results are cached for 15 minutes per rooftop + account combination.',
  })
  @ApiParam({
    name: 'partNumber',
    description: 'OEM part number — hyphens and case are normalised automatically. e.g. "04465-0D060"',
    example: '04465-0D060',
  })
  @ApiQuery({ name: 'rooftopId', required: true, description: 'Requesting rooftop slug — e.g. "ROOFTOP-DANDENONG"', example: 'ROOFTOP-DANDENONG' })
  @ApiQuery({ name: 'accountId', required: true, description: 'Pentana trade account ID — e.g. "ACC-000123"', example: 'ACC-000123' })
  @ApiQuery({ name: 'brandCode', required: false, description: 'OEM brand code hint — skips brand detection when supplied', example: 'TOYOTA' })
  @ApiResponse({
    status: 200,
    description:
      'Resolution result — { partNumber, brandCode, rooftopId, accountId, cachedAt, sources[] }. ' +
      'Each source has: sourceKind, sourceName, sourceRooftopId, listPriceCents, tradePriceCents, ' +
      'coreChargeCents, stockQty, inStock, eta, binLocation, probeSuccess, probeError, resolvedAt.',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'Part not found in catalogue' })
  resolveSource(
    @Param('partNumber') partNumber: string,
    @Query() dto: ResolvePartDto,
    @CurrentUser() user: UserDocument,
  ) {
    return this.partsService.resolveSource(partNumber, dto, user);
  }

  // ─── GET /parts/:id ───────────────────────────────────────────────────────

  /**
   * Single part detail by MongoDB _id or OEM part number.
   * Accepts either a 24-character hex ObjectId or a raw OEM part number
   * (hyphens/case normalised automatically).
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Part detail',
    description:
      'Fetch a single catalogue part by its MongoDB ObjectId or OEM part number. ' +
      'Part numbers are normalised (hyphens stripped, upper-cased) before matching.',
  })
  @ApiParam({
    name: 'id',
    description:
      '24-char MongoDB ObjectId — e.g. "507f1f77bcf86cd799439011" — ' +
      'or OEM part number — e.g. "04465-0D060"',
    example: '04465-0D060',
  })
  @ApiResponse({ status: 200, description: 'Part document' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'Part not found' })
  findOne(@Param('id') id: string) {
    return this.partsService.findOne(id);
  }
}
