import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthCookiesService, REFRESH_COOKIE, requestCookie } from './auth-cookies.service';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyTotpDto, EnrollTotpDto, ConfirmTotpDto, DisableTotpDto } from './dto/verify-totp.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserDocument } from './schemas/user.schema';
import { Role } from '../common/enums/roles.enum';
import { AccountEmailDto, AccountTokenDto, ResetPasswordDto } from './dto/account-recovery.dto';
import { AuthRateLimitGuard, LimitAuth } from './auth-rate-limit.guard';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly cookies: AuthCookiesService) {}

  @Get('csrf')
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.cookies.csrf(req, res);
  }

  @Post('resend-verification')
  @LimitAuth('forgot-password')
  @HttpCode(HttpStatus.OK)
  resendVerification(@Body() dto: AccountEmailDto) {
    // Legacy request URL shares the unified recovery flow and rate-limit bucket.
    return this.authService.requestAccountEmail(dto.email, 'reset-password');
  }

  @Post('verify-email')
  @LimitAuth('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: AccountTokenDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('forgot-password')
  @LimitAuth('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: AccountEmailDto) {
    return this.authService.requestAccountEmail(dto.email, 'reset-password');
  }

  @Post('reset-password')
  @LimitAuth('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.resetPassword(dto.token, dto.password);
    this.cookies.clearSession(res);
    return result;
  }

  @Post('register')
  @LimitAuth('register')
  @ApiOperation({ summary: 'Register a new trade partner account' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, req.ip);
  }

  @Post('login')
  @LimitAuth('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Sets HttpOnly session cookies and returns the user' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto, req.ip);
    if ('requiresTotp' in result) {
      this.cookies.clearSession(res);
      return result;
    }
    this.cookies.setSession(res, result);
    return { user: result.user, expiresAt: result.expiresAt };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and invalidate session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.logoutSession(requestCookie(req, REFRESH_COOKIE), req.ip);
    this.cookies.clearSession(res);
    return result;
  }

  @Post('refresh')
  @LimitAuth('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate session cookies using the HttpOnly refresh cookie' })
  @ApiResponse({ status: 200, description: 'Sets refreshed HttpOnly session cookies' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.authService.refreshToken(requestCookie(req, REFRESH_COOKIE) || '', req.ip);
      this.cookies.setSession(res, result);
      return { expiresAt: result.expiresAt };
    } catch (error) {
      if (error?.getStatus?.() === 401) this.cookies.clearSession(res);
      throw error;
    }
  }

  @Post('totp/enroll')
  @LimitAuth('totp-enroll')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enroll TOTP 2FA — returns QR code to scan' })
  async enrollTotp(@CurrentUser() user: UserDocument, @Body() dto: EnrollTotpDto) {
    return this.authService.enrollTotp(user, dto.password);
  }

  @Get('totp/status')
  @UseGuards(JwtAuthGuard)
  totpStatus(@CurrentUser() user: UserDocument) { return this.authService.totpStatus(user); }

  @Post('totp/confirm')
  @LimitAuth('totp-confirm')
  @UseGuards(JwtAuthGuard)
  async confirmTotp(@CurrentUser() user: UserDocument, @Body() dto: ConfirmTotpDto,
    @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.confirmTotp(user, dto.factorId, dto.code, req.ip);
    this.cookies.setSession(res, result);
    return { user: result.user, recoveryCodes: result.recoveryCodes };
  }

  @Post('totp/disable')
  @LimitAuth('totp-disable')
  @UseGuards(JwtAuthGuard)
  async disableTotp(@CurrentUser() user: UserDocument, @Body() dto: DisableTotpDto,
    @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.disableTotp(user, dto.password, dto.code, req.ip);
    this.cookies.setSession(res, result);
    return { user: result.user, message: 'Two-factor authentication disabled' };
  }

  @Post('totp/verify')
  @LimitAuth('totp-verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify TOTP code to complete 2FA login' })
  async verifyTotp(@Body() dto: VerifyTotpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.verifyTotp(dto, req.ip);
    this.cookies.setSession(res, result);
    return { user: result.user, expiresAt: result.expiresAt };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  async getMe(@CurrentUser() user: UserDocument) {
    return this.authService.getMe(user);
  }

  // ─── ADMIN USER MANAGEMENT ──────────────────────────────────────────────────

  @Post('users')
  @LimitAuth('admin-create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.GROUP_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Provision a user with an assigned role (Admin only)' })
  async createUser(@Body() dto: RegisterDto, @CurrentUser() admin: UserDocument, @Req() req: Request) {
    return this.authService.register(dto, req.ip, admin);
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.GROUP_ADMIN, Role.CSUITES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List users with search, role, rooftop and status filtering (Admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  async listUsers(@Query() query: ListUsersQueryDto) {
    return this.authService.listUsers(query);
  }

  @Get('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.GROUP_ADMIN, Role.CSUITES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user details by ID (Admin only)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User details' })
  async getUserById(@Param('id') id: string) {
    return this.authService.getUserById(id);
  }

  @Patch('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.GROUP_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user role, status, precinct assignment or details (Admin only)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() adminUser: UserDocument,
    @Req() req: Request,
  ) {
    return this.authService.updateUser(id, dto, adminUser, req.ip);
  }

  @Delete('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.GROUP_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete user account (Admin only)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  async deleteUser(
    @Param('id') id: string,
    @CurrentUser() adminUser: UserDocument,
    @Req() req: Request,
  ) {
    return this.authService.deleteUser(id, adminUser, req.ip);
  }
}
