import {
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryAccountsDto {
  @ApiPropertyOptional({
    description: 'Free-text search query across accountId, companyName, contactName, email, and phone',
    example: 'Apex',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by servicing rooftop precinct slug',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  rooftopId?: string;

  @ApiPropertyOptional({
    description: 'Filter by credit hold status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined)
  @IsBoolean()
  creditHold?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by overdue payment status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined)
  @IsBoolean()
  isOverdue?: boolean;

  @ApiPropertyOptional({
    description: '1-based page number for pagination. Defaults to 1.',
    default: 1,
    minimum: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Page size for pagination. Defaults to 20, max 100.',
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
