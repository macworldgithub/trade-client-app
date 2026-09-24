import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
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
import { AccountsService } from './accounts.service';
import { UpdateCreditHoldDto } from './dto/update-credit-hold.dto';
import { UpdateOverdueDto } from './dto/update-overdue.dto';
import { SpendQueryDto } from './dto/spend-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/roles.enum';
import { UserDocument } from '../auth/schemas/user.schema';

/** Roles that can manage account flags (credit-hold / overdue) */
const CONTROLLER_ROLES = [
  Role.PARTS_CONTROLLER,
  Role.STORE_MANAGER,
  Role.GROUP_ADMIN,
];

@ApiTags('Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  // ─── GET /accounts/my ──────────────────────────────────────────────────────
  // IMPORTANT: must be declared before /:id so Express does not treat "my"
  // as an :id param value.

  @Get('my')
  @ApiOperation({
    summary: "Current trade partner's own account",
    description:
      "Returns the trade account linked to the authenticated user's profile (User.tradeAccountId). " +
      'Accessible to all authenticated roles; a trade_partner can only ever see their own account.',
  })
  @ApiResponse({ status: 200, description: 'Trade account document' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'User profile is not linked to a trade account' })
  @ApiResponse({ status: 404, description: 'Trade account not found' })
  getMyAccount(@CurrentUser() user: UserDocument) {
    return this.accountsService.findMine(user);
  }

  // ─── GET /accounts ─────────────────────────────────────────────────────────

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.STORE_MANAGER, Role.GROUP_ADMIN, Role.PARTS_CONTROLLER)
  @ApiOperation({
    summary: 'List all trade accounts',
    description:
      'Returns all active trade accounts sorted alphabetically by company name. ' +
      'Restricted to store_manager, parts_controller, and group_admin.',
  })
  @ApiResponse({ status: 200, description: 'Array of trade account documents' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  findAll() {
    return this.accountsService.findAll();
  }

  // ─── GET /accounts/:id ─────────────────────────────────────────────────────

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.STORE_MANAGER, Role.GROUP_ADMIN, Role.PARTS_CONTROLLER)
  @ApiOperation({
    summary: 'Trade account detail',
    description:
      'Returns full account detail including payment terms, YTD figures, discount rate, ' +
      'and current status flags. Accepts either the Pentana accountId slug or the Mongo _id.',
  })
  @ApiParam({
    name: 'id',
    description: 'Pentana accountId (e.g. "ACC-000123") or Mongo _id',
  })
  @ApiResponse({ status: 200, description: 'Trade account document' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Trade account not found' })
  findOne(@Param('id') id: string) {
    return this.accountsService.findOne(id);
  }

  // ─── PATCH /accounts/:id/credit-hold ───────────────────────────────────────

  @Patch(':id/credit-hold')
  @UseGuards(RolesGuard)
  @Roles(...CONTROLLER_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set or unset credit hold',
    description:
      'Places the account on credit hold (creditHold: true) or releases it (creditHold: false). ' +
      'While on hold the account cannot submit new orders. ' +
      'Restricted to parts_controller, store_manager, and group_admin.',
  })
  @ApiParam({
    name: 'id',
    description: 'Pentana accountId or Mongo _id of the account to update',
  })
  @ApiResponse({ status: 200, description: 'Updated trade account document' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Trade account not found' })
  setCreditHold(
    @Param('id') id: string,
    @Body() dto: UpdateCreditHoldDto,
  ) {
    return this.accountsService.setCreditHold(id, dto);
  }

  // ─── PATCH /accounts/:id/overdue ───────────────────────────────────────────

  @Patch(':id/overdue')
  @UseGuards(RolesGuard)
  @Roles(...CONTROLLER_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set or unset overdue flag',
    description:
      'Marks the account as overdue (isOverdue: true) or clears the flag (isOverdue: false). ' +
      'Restricted to parts_controller, store_manager, and group_admin.',
  })
  @ApiParam({
    name: 'id',
    description: 'Pentana accountId or Mongo _id of the account to update',
  })
  @ApiResponse({ status: 200, description: 'Updated trade account document' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Trade account not found' })
  setOverdue(
    @Param('id') id: string,
    @Body() dto: UpdateOverdueDto,
  ) {
    return this.accountsService.setOverdue(id, dto);
  }

  // ─── GET /accounts/:id/spend ───────────────────────────────────────────────

  @Get(':id/spend')
  @UseGuards(RolesGuard)
  @Roles(Role.STORE_MANAGER, Role.GROUP_ADMIN, Role.PARTS_CONTROLLER)
  @ApiOperation({
    summary: 'YTD spend summary for an account',
    description:
      'Returns year-to-date spend (in AUD cents), order count, credit limit, ' +
      'current balance, and discount rate for the given account. ' +
      'Defaults to the current calendar year; pass ?year=YYYY to request a specific year.',
  })
  @ApiParam({
    name: 'id',
    description: 'Pentana accountId or Mongo _id',
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Calendar year (e.g. 2026). Defaults to current year.',
    example: 2026,
  })
  @ApiResponse({ status: 200, description: 'YTD spend summary object' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Trade account not found' })
  getSpend(
    @Param('id') id: string,
    @Query() query: SpendQueryDto,
  ) {
    return this.accountsService.getSpend(id, query);
  }
}
