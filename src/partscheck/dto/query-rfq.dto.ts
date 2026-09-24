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
import { RfqStatus } from '../enums/rfq-status.enum';

export class QueryRfqDto {
  @ApiPropertyOptional({
    description: 'Filter RFQs by rooftop precinct slug',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  rooftopId?: string;

  @ApiPropertyOptional({
    description: 'Filter RFQs by mapped trade account ID',
    example: 'ACC-000123',
  })
  @IsOptional()
  @IsString()
  tradeAccountId?: string;

  @ApiPropertyOptional({
    description: 'Filter RFQs by lifecycle status',
    enum: RfqStatus,
    example: RfqStatus.PENDING_REVIEW,
  })
  @IsOptional()
  @IsEnum(RfqStatus)
  status?: RfqStatus;

  @ApiPropertyOptional({
    description: 'Filter by buyer mapping status (true = mapped, false = unmapped buyer)',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isBuyerMapped?: boolean;

  @ApiPropertyOptional({
    description: 'Search string matching rfqId, repairerName, claimNumber, or part numbers',
    example: 'PC-RFQ-10293',
  })
  @IsOptional()
  @IsString()
  search?: string;

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
