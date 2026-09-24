import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/roles.enum';
import { AuditAction } from '../auth/schemas/audit-event.schema';

const AUDIT_READ_ROLES = [
  Role.GROUP_ADMIN,
  Role.STORE_MANAGER,
  Role.CSUITES,
  Role.PARTS_CONTROLLER,
];

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(...AUDIT_READ_ROLES)
  @ApiOperation({
    summary: 'Query audit event stream',
    description:
      'Retrieves immutable, time-stamped audit events across all sessions and operations. ' +
      'Retained for 24 months. Supports filtering by userId, orderId/orderNumber, rooftopId, ' +
      'tradeAccountId, action type, and date ranges. ' +
      'Restricted to group_admin, store_manager, csuites, and parts_controller.',
  })
  @ApiQuery({ name: 'userId', required: false, description: 'Supabase user ID or user identifier' })
  @ApiQuery({ name: 'orderId', required: false, description: 'Order ID or canonical order number' })
  @ApiQuery({ name: 'rooftopId', required: false, description: 'Rooftop precinct slug — e.g. "ROOFTOP-DANDENONG"' })
  @ApiQuery({ name: 'tradeAccountId', required: false, description: 'Pentana trade account ID — e.g. "ACC-000123"' })
  @ApiQuery({ name: 'action', required: false, enum: AuditAction, description: 'Audit action type' })
  @ApiQuery({ name: 'from', required: false, description: 'Start date / timestamp (ISO string)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date / timestamp (ISO string)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 50)', example: 50 })
  @ApiQuery({ name: 'page', required: false, description: '1-based page number (default 1)', example: 1 })
  @ApiResponse({
    status: 200,
    description: 'Paginated audit event stream — { total, page, limit, totalPages, events[] }',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — Insufficient role permissions' })
  findAll(@Query() query: QueryAuditDto) {
    return this.auditService.findAll(query);
  }
}
