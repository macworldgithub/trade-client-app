import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction } from '../../auth/schemas/audit-event.schema';

export class QueryAuditDto {
  @ApiPropertyOptional({
    description: 'Filter audit stream by user identity (supabaseId or email)',
    example: 'sub-user-123',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description:
      'Filter audit stream by specific order ID or canonical order number',
    example: 'ORD-20260924-A1B2',
  })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({
    description: 'Filter audit stream by rooftop precinct slug',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  rooftopId?: string;

  @ApiPropertyOptional({
    description: 'Filter audit stream by trade account ID',
    example: 'ACC-000123',
  })
  @IsOptional()
  @IsString()
  tradeAccountId?: string;

  @ApiPropertyOptional({
    description: 'Filter audit stream by action type',
    enum: AuditAction,
    example: AuditAction.ORDER_SUBMIT,
  })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({
    description: 'Start date / timestamp filter (ISO string, e.g. 2026-09-01)',
    example: '2026-09-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End date / timestamp filter (ISO string, e.g. 2026-09-30)',
    example: '2026-09-30T23:59:59.999Z',
  })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Page size (1–100, default 50)',
    example: 50,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({
    description: '1-based page number (default 1)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
}
