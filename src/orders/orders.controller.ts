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
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { OrderQueueQueryDto } from './dto/order-queue-query.dto';
import { UpdateOrderStateDto } from './dto/update-order-state.dto';
import { RaiseLineExceptionDto } from './dto/raise-line-exception.dto';
import { ReSourceLineDto } from './dto/re-source-line.dto';
import { PickLineDto } from './dto/pick-line.dto';
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
];

const STAFF_ROLES = [
  Role.PARTS_CONTROLLER,
  Role.STORE_MANAGER,
  Role.GROUP_ADMIN,
  Role.CSUITES,
];

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ─── POST /orders ─────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a new order',
    description:
      'Creates a new parts order containing one or more line items. ' +
      'Automatically validates credit hold, calculates discounts, totals & GST, ' +
      'and increments trade account YTD spend metrics. ' +
      'Trade partners are locked to their own account; staff can specify a target account.',
  })
  @ApiResponse({
    status: 201,
    description: 'Order created successfully with assigned orderNumber and line states',
  })
  @ApiResponse({ status: 400, description: 'Invalid input or missing required fields' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({
    status: 403,
    description: 'Account is on credit hold or user has no trade account linked',
  })
  @ApiResponse({ status: 404, description: 'Trade account or rooftop not found' })
  submitOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    return this.ordersService.submitOrder(dto, user, req.ip);
  }

  // ─── GET /orders ──────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Partner order history & order search',
    description:
      'Returns a paginated list of orders matching filter criteria. ' +
      'Trade partners only receive orders for their own account. ' +
      'Staff can filter by tradeAccountId, rooftopId, order state, date range, or keywords.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated order list — { total, page, limit, totalPages, orders[] }',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  findAll(
    @Query() query: QueryOrdersDto,
    @CurrentUser() user: UserDocument,
  ) {
    return this.ordersService.findAll(query, user);
  }

  // ─── GET /orders/queue ────────────────────────────────────────────────────
  // IMPORTANT: Declared before /:id to prevent Express routing "queue" into :id

  @Get('queue')
  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @ApiOperation({
    summary: 'Controller fulfillment queue view',
    description:
      'Provides parts controllers and warehouse pickers with an operational queue of active orders. ' +
      'Includes queue summary counters (total queued, pending picking, exceptions count) ' +
      'and sorts orders with active exceptions first followed by FIFO order creation.',
  })
  @ApiQuery({
    name: 'rooftopId',
    required: false,
    description: 'Rooftop precinct slug (defaults to current user precinct if set)',
    example: 'ROOFTOP-DANDENONG',
  })
  @ApiResponse({
    status: 200,
    description: 'Controller queue data — { rooftopId, summary, pagination, orders[] }',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — Staff roles only' })
  getQueue(
    @Query() query: OrderQueueQueryDto,
    @CurrentUser() user: UserDocument,
  ) {
    return this.ordersService.getQueue(query, user);
  }

  // ─── GET /orders/:id ──────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary: 'Get order detail + line states',
    description:
      'Retrieves complete order document including lines, their current fulfillment states, ' +
      'sourcing locations, exception details, and picking history. ' +
      'Accepts either a MongoDB ObjectId or canonical orderNumber (e.g. "ORD-20260924-A1B2").',
  })
  @ApiParam({
    name: 'id',
    description: 'Order MongoDB _id or orderNumber slug',
    example: 'ORD-20260924-A1B2',
  })
  @ApiResponse({ status: 200, description: 'Order document with full line states' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — Order belongs to another account' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  findOne(@Param('id') id: string, @CurrentUser() user: UserDocument) {
    return this.ordersService.findOne(id, user);
  }

  // ─── PATCH /orders/:id/state ──────────────────────────────────────────────

  @Patch(':id/state')
  @UseGuards(RolesGuard)
  @Roles(...CONTROLLER_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Controller updates overall order state',
    description:
      'Updates the lifecycle state of an entire order (e.g. PROCESSING, READY_FOR_DELIVERY, DISPATCHED). ' +
      'Records state change in statusHistory and writes an audit event. ' +
      'Restricted to parts_controller, store_manager, and group_admin.',
  })
  @ApiParam({
    name: 'id',
    description: 'Order MongoDB _id or orderNumber',
    example: 'ORD-20260924-A1B2',
  })
  @ApiResponse({ status: 200, description: 'Updated order document' })
  @ApiResponse({ status: 400, description: 'Invalid state transition' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — Controller roles only' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  updateState(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStateDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    return this.ordersService.updateState(id, dto, user, req.ip);
  }

  // ─── POST /orders/:id/lines/:lineId/exception ─────────────────────────────

  @Post(':id/lines/:lineId/exception')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Raise an exception on an order line',
    description:
      'Flags a specific line item with an exception condition (e.g. OUT_OF_STOCK, DAMAGED, INCORRECT_BIN). ' +
      'Sets line state to EXCEPTION, flags order as hasExceptions: true, and elevates order to EXCEPTION state. ' +
      'Logs an EXCEPTION audit event.',
  })
  @ApiParam({
    name: 'id',
    description: 'Order MongoDB _id or orderNumber',
    example: 'ORD-20260924-A1B2',
  })
  @ApiParam({
    name: 'lineId',
    description: 'Line ID (e.g. "LIN-01") or OEM part number',
    example: 'LIN-01',
  })
  @ApiResponse({ status: 200, description: 'Updated order document with flagged line exception' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  raiseLineException(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: RaiseLineExceptionDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    return this.ordersService.raiseLineException(id, lineId, dto, user, req.ip);
  }

  // ─── PATCH /orders/:id/lines/:lineId/re-source ────────────────────────────

  @Patch(':id/lines/:lineId/re-source')
  @UseGuards(RolesGuard)
  @Roles(...CONTROLLER_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Controller re-sources an order line item',
    description:
      'Re-routes an unfulfilled or exception line item to a different source tier (SISTER branch, OEM, or AFTERMARKET). ' +
      'Records old and new source details in reSourceHistory, updates pricing/bin/ETA if changed, ' +
      'resolves the line exception, and automatically clears the order exception state if all lines are resolved. ' +
      'Restricted to parts_controller, store_manager, and group_admin.',
  })
  @ApiParam({
    name: 'id',
    description: 'Order MongoDB _id or orderNumber',
    example: 'ORD-20260924-A1B2',
  })
  @ApiParam({
    name: 'lineId',
    description: 'Line ID (e.g. "LIN-01") or OEM part number',
    example: 'LIN-01',
  })
  @ApiResponse({ status: 200, description: 'Updated order document with re-sourced line item' })
  @ApiResponse({ status: 400, description: 'Invalid re-sourcing payload' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — Controller roles only' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  reSourceLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: ReSourceLineDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    return this.ordersService.reSourceLine(id, lineId, dto, user, req.ip);
  }

  // ─── PATCH /orders/:id/lines/:lineId/pick ─────────────────────────────────

  @Patch(':id/lines/:lineId/pick')
  @UseGuards(RolesGuard)
  @Roles(...CONTROLLER_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm picking on an order line item',
    description:
      'Records warehouse pick confirmation for a line item. ' +
      'Sets line state to PICKED with timestamp and picker identity. ' +
      'Automatically transitions overall order state to PARTIALLY_PICKED or PICKED if all lines are complete. ' +
      'Restricted to parts_controller, store_manager, and group_admin.',
  })
  @ApiParam({
    name: 'id',
    description: 'Order MongoDB _id or orderNumber',
    example: 'ORD-20260924-A1B2',
  })
  @ApiParam({
    name: 'lineId',
    description: 'Line ID (e.g. "LIN-01") or OEM part number',
    example: 'LIN-01',
  })
  @ApiResponse({ status: 200, description: 'Updated order document with confirmed pick' })
  @ApiResponse({ status: 400, description: 'Cannot pick cancelled line' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — Controller roles only' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  pickLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: PickLineDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    return this.ordersService.pickLine(id, lineId, dto, user, req.ip);
  }
}
