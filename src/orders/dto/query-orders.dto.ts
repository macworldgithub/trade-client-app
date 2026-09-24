import {
  IsOptional,
  IsString,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrderState } from '../enums/order-state.enum';
import { DeliveryMethod } from '../enums/delivery-method.enum';

export class QueryOrdersDto {
  @ApiPropertyOptional({
    description: 'Filter by trade account ID (staff only; partners are automatically scoped to own account)',
    example: 'ACC-000123',
  })
  @IsOptional()
  @IsString()
  tradeAccountId?: string;

  @ApiPropertyOptional({
    description: 'Filter by servicing rooftop precinct slug',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  rooftopId?: string;

  @ApiPropertyOptional({
    description: 'Filter by overall order state',
    enum: OrderState,
    example: OrderState.PROCESSING,
  })
  @IsOptional()
  @IsEnum(OrderState)
  state?: OrderState;

  @ApiPropertyOptional({
    description: 'Filter to orders with active line exceptions',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasExceptions?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by delivery method',
    enum: DeliveryMethod,
    example: DeliveryMethod.DELIVERY,
  })
  @IsOptional()
  @IsEnum(DeliveryMethod)
  deliveryMethod?: DeliveryMethod;

  @ApiPropertyOptional({
    description:
      'Search query matching orderNumber, customerReference, partNumber, or workshop name',
    example: 'PO-99482',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Start date filter (ISO string, e.g. 2026-09-01)',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End date filter (ISO string, e.g. 2026-09-30)',
    example: '2026-09-30',
  })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Page size (1–100, default 20)',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

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
