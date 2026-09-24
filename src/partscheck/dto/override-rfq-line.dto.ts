import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SourceKind } from '../../parts/schemas/part-source.schema';

export class OverrideRfqLineDto {
  @ApiPropertyOptional({
    description: 'Updated / corrected part number',
    example: '04465-0D060',
  })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiPropertyOptional({
    description: 'Updated part description',
    example: 'FRONT BRAKE PAD SET',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Unit trade price to quote in AUD cents',
    example: 8550,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitTradePriceCents: number;

  @ApiPropertyOptional({
    description: 'Core deposit charge in AUD cents',
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  coreChargeCents?: number;

  @ApiPropertyOptional({
    description: 'Source tier chosen for resolution',
    enum: SourceKind,
    example: SourceKind.BRANCH,
  })
  @IsOptional()
  @IsEnum(SourceKind)
  sourceKind?: SourceKind;

  @ApiPropertyOptional({
    description: 'Source location name',
    example: 'Dandenong Parts',
  })
  @IsOptional()
  @IsString()
  sourceName?: string;

  @ApiPropertyOptional({
    description: 'Sister branch rooftop ID if applicable',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  sourceRooftopId?: string;

  @ApiPropertyOptional({
    description: 'Available stock quantity',
    example: 4,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQty?: number;

  @ApiPropertyOptional({
    description: 'Whether stock is available',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({
    description: 'Estimated delivery / arrival time',
    example: 'Same day',
  })
  @IsOptional()
  @IsString()
  eta?: string;

  @ApiPropertyOptional({
    description: 'Bin location at branch warehouse',
    example: 'A-12-03',
  })
  @IsOptional()
  @IsString()
  binLocation?: string;

  @ApiProperty({
    description: 'Reason for controller line override',
    example: 'Applied 10% promotional trade discount',
  })
  @IsString()
  @IsNotEmpty()
  notes: string;
}
