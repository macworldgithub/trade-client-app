import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DashboardService } from './dashboard.service';
import { WeeklyExportQueryDto, ExportFormat } from './dto/weekly-export-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/roles.enum';
import { UserDocument } from '../auth/schemas/user.schema';

const EXECUTIVE_ROLES = [
  Role.CSUITES,
  Role.GROUP_ADMIN,
  Role.STORE_MANAGER,
];

const STORE_ROLES = [
  Role.STORE_MANAGER,
  Role.PARTS_CONTROLLER,
  Role.GROUP_ADMIN,
  Role.CSUITES,
];

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // ─── GET /dashboard/group ─────────────────────────────────────────────────

  @Get('group')
  @Roles(...EXECUTIVE_ROLES)
  @ApiOperation({
    summary: 'C-suite group network view',
    description:
      'Provides high-level executive metrics across all 9 precincts: total revenue, ' +
      'order pipeline status breakdown, accounts credit exposure, precinct comparison, and recent audit activity.',
  })
  @ApiResponse({
    status: 200,
    description: 'Executive network dashboard data',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — Executive roles only' })
  getGroupView(@CurrentUser() user: UserDocument) {
    return this.dashboardService.getGroupView(user);
  }

  // ─── GET /dashboard/group/partscheck ──────────────────────────────────────

  @Get('group/partscheck')
  @Roles(...EXECUTIVE_ROLES)
  @ApiOperation({
    summary: 'Group PartsCheck performance tiles',
    description:
      'Network-wide PartsCheck metrics: total inbound RFQs, automated quote-back rate (%), ' +
      'win/conversion rate (%), SLA compliance rate, and per-precinct performance tiles.',
  })
  @ApiResponse({
    status: 200,
    description: 'Group PartsCheck performance metrics and KPI tiles',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — Executive roles only' })
  getGroupPartsCheckView() {
    return this.dashboardService.getGroupPartsCheckView();
  }

  // ─── GET /dashboard/export/weekly ─────────────────────────────────────────
  // Declared before :rooftopId to prevent route ambiguity

  @Get('export/weekly')
  @Roles(...STORE_ROLES)
  @ApiOperation({
    summary: 'Weekly PDF/CSV management pack export',
    description:
      'Generates a weekly executive summary report containing financial totals, top trade accounts, ' +
      'top fast-moving parts, PartsCheck conversion, and full order ledger. ' +
      'Pass `format=csv` to download a CSV spreadsheet.',
  })
  @ApiQuery({
    name: 'rooftopId',
    required: false,
    description: 'Precinct slug (omit for group-wide rollup)',
    example: 'ROOFTOP-DANDENONG',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ExportFormat,
    description: 'Output format (json or csv)',
  })
  @ApiQuery({
    name: 'week',
    required: false,
    description: 'ISO date within the desired report week (defaults to current week)',
    example: '2026-09-24',
  })
  @ApiResponse({
    status: 200,
    description: 'Weekly management pack data (JSON or CSV attachment)',
  })
  async getWeeklyExport(
    @Query() query: WeeklyExportQueryDto,
    @CurrentUser() user: UserDocument,
    @Res() res: Response,
  ) {
    const result = await this.dashboardService.getWeeklyExport(query, user);

    if (query.format === ExportFormat.CSV && result.csvString) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      return res.status(HttpStatus.OK).send(result.csvString);
    }

    return res.status(HttpStatus.OK).json(result.data);
  }

  // ─── GET /dashboard/store/:rooftopId ──────────────────────────────────────

  @Get('store/:rooftopId')
  @Roles(...STORE_ROLES)
  @ApiOperation({
    summary: 'Store-manager precinct view',
    description:
      'Detailed operational dashboard for a specific dealership precinct. ' +
      'Includes real-time fulfillment queue (pending picking, partially picked, picked ready), ' +
      'today/week financial volume, precinct credit hold alerts, and active RFQ counts.',
  })
  @ApiParam({
    name: 'rooftopId',
    description: 'Precinct slug (e.g. "ROOFTOP-DANDENONG")',
    example: 'ROOFTOP-DANDENONG',
  })
  @ApiResponse({
    status: 200,
    description: 'Store-manager precinct dashboard data',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — Insufficient role permissions' })
  @ApiResponse({ status: 404, description: 'Rooftop precinct not found' })
  getStoreView(
    @Param('rooftopId') rooftopId: string,
    @CurrentUser() user: UserDocument,
  ) {
    return this.dashboardService.getStoreView(rooftopId, user);
  }

  // ─── GET /dashboard/store/:rooftopId/partscheck ───────────────────────────

  @Get('store/:rooftopId/partscheck')
  @Roles(...STORE_ROLES)
  @ApiOperation({
    summary: 'Store PartsCheck SLA tiles',
    description:
      'Precinct-specific PartsCheck performance dashboard: auto-quoted vs manual count, ' +
      'SLA adherence rate, urgent quotes expiring within 1 hour, and repairer win rate.',
  })
  @ApiParam({
    name: 'rooftopId',
    description: 'Precinct slug (e.g. "ROOFTOP-DANDENONG")',
    example: 'ROOFTOP-DANDENONG',
  })
  @ApiResponse({
    status: 200,
    description: 'Store PartsCheck SLA performance metrics',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'Rooftop precinct not found' })
  getStorePartsCheckView(
    @Param('rooftopId') rooftopId: string,
    @CurrentUser() user: UserDocument,
  ) {
    return this.dashboardService.getStorePartsCheckView(rooftopId, user);
  }
}
