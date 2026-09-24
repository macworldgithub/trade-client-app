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

export class OrderQueueQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter queue by rooftop precinct slug. Defaults to user rooftop if not provided.',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  rooftopId?: string;

  @ApiPropertyOptional({
    description: 'Filter queue by specific order state',
    enum: OrderState,
    example: OrderState.SUBMITTED,
  })
  @IsOptional()
  @IsEnum(OrderState)
  state?: OrderState;

  @ApiPropertyOptional({
    description: 'Filter queue to only items with active exceptions',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hasExceptions?: boolean;

  @ApiPropertyOptional({
    description: 'Page size (1–100, default 50 for controller queue)',
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
