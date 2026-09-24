import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { PartsCheckService } from './partscheck.service';
import { InboundRfqDto } from './dto/inbound-rfq.dto';
import { QueryRfqDto } from './dto/query-rfq.dto';
import { TriggerQuoteDto } from './dto/trigger-quote.dto';
import { OverrideRfqLineDto } from './dto/override-rfq-line.dto';
import { AcceptRfqDto } from './dto/accept-rfq.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/roles.enum';
import { UserDocument } from '../auth/schemas/user.schema';

const CONTROLLER_ROLES = [
  Role.PARTS_CONTROLLER,
  Role.STORE_MANAGER,
  Role.GROUP_ADMIN,
  Role.CSUITES,
];

@ApiTags('PartsCheck')
@Controller('partscheck')
export class PartsCheckController {
  constructor(private readonly partsCheckService: PartsCheckService) {}

  // ─── POST /partscheck/rfq ─────────────────────────────────────────────────

  @Post('rfq')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inbound webhook for PartsCheck RFQs',
    description:
      'Receives RFQs from PartsCheck. Automatically checks buyer mapping to TradeAccount. ' +
      'If buyer is mapped and all lines resolve, automatically generates quote-back payload before SLA deadline. ' +
      'Unmapped buyers are flagged UNMAPPED_BUYER and never auto-quoted.',
  })
  @ApiResponse({
    status: 200,
    description: 'RFQ processed, stored, and evaluated for automated quote-back',
  })
  @ApiResponse({ status: 400, description: 'Invalid RFQ payload' })
  handleInboundRfq(@Body() dto: InboundRfqDto, @Req() req: Request) {
    return this.partsCheckService.handleInboundRfq(dto, req.ip);
  }

  // ─── GET /partscheck/rfq ──────────────────────────────────────────────────

  @Get('rfq')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...CONTROLLER_ROLES)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Controller RFQ inbox & SLA clock view',
    description:
      'Lists open PartsCheck RFQs with dynamic SLA countdown clocks, urgency levels, ' +
      'and resolution statuses. Supports filtering by rooftop, mapped status, and lifecycle state.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated RFQ inbox with SLA clock data and summary counters',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — Staff only' })
  getInbox(@Query() query: QueryRfqDto) {
    return this.partsCheckService.getInbox(query);
  }

  // ─── GET /partscheck/rfq/:id ──────────────────────────────────────────────

  @Get('rfq/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...CONTROLLER_ROLES)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'RFQ detail with line-by-line resolution and SLA status',
    description:
      'Retrieves complete RFQ document by MongoDB ObjectId or PartsCheck rfqId, ' +
      'including line items, current pricing, override notes, and quote payload.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB _id or PartsCheck rfqId (e.g. "PC-RFQ-10293")',
    example: 'PC-RFQ-10293',
  })
  @ApiResponse({ status: 200, description: 'PartsCheck RFQ detail object' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'RFQ not found' })
  findOne(@Param('id') id: string) {
    return this.partsCheckService.findOne(id);
  }

  // ─── POST /partscheck/rfq/:id/quote ───────────────────────────────────────

  @Post('rfq/:id/quote')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...CONTROLLER_ROLES)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger quote-back to PartsCheck (exception path)',
    description:
      'Triggers quote-back for an RFQ following manual controller review or resolution. ' +
      'Validates all lines have pricing, computes totals, sets state MANUALLY_QUOTED, and writes an audit event.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB _id or PartsCheck rfqId',
    example: 'PC-RFQ-10293',
  })
  @ApiResponse({ status: 200, description: 'Quote-back generated and logged' })
  @ApiResponse({ status: 400, description: 'Some lines have no resolved price' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'RFQ not found' })
  triggerQuote(
    @Param('id') id: string,
    @Body() dto: TriggerQuoteDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    return this.partsCheckService.triggerQuote(id, dto, user, req.ip);
  }

  // ─── PATCH /partscheck/rfq/:id/lines/:lineId/override ─────────────────────

  @Patch('rfq/:id/lines/:lineId/override')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...CONTROLLER_ROLES)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Controller manually overrides / resolves an RFQ line',
    description:
      'Manually sets pricing, sourcing location, or stock availability on an RFQ line item. ' +
      'Recalculates RFQ pricing totals and records audit trail.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB _id or PartsCheck rfqId',
    example: 'PC-RFQ-10293',
  })
  @ApiParam({
    name: 'lineId',
    description: 'Line ID (e.g. "PC-LIN-01") or OEM part number',
    example: 'PC-LIN-01',
  })
  @ApiResponse({ status: 200, description: 'RFQ line updated with controller override' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'RFQ or line not found' })
  overrideLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: OverrideRfqLineDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    return this.partsCheckService.overrideLine(id, lineId, dto, user, req.ip);
  }

  // ─── POST /partscheck/rfq/:id/accept ──────────────────────────────────────

  @Post('rfq/:id/accept')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...CONTROLLER_ROLES)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Repairer accepts quote — raises TradeOrder tagged source=PARTSCHECK',
    description:
      'Converts an accepted PartsCheck quote into a live TradeOrder linked to the mapped trade account and rooftop.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB _id or PartsCheck rfqId',
    example: 'PC-RFQ-10293',
  })
  @ApiResponse({ status: 201, description: 'TradeOrder raised successfully' })
  @ApiResponse({ status: 400, description: 'Buyer not mapped to trade account' })
  @ApiResponse({ status: 404, description: 'RFQ not found' })
  acceptRfq(
    @Param('id') id: string,
    @Body() dto: AcceptRfqDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    return this.partsCheckService.acceptRfq(id, dto, user, req.ip);
  }
}
