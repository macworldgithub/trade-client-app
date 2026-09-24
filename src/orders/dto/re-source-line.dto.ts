import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SourceKind } from '../../parts/schemas/part-source.schema';

export class ReSourceLineDto {
  @ApiProperty({
    description: 'New source tier to fulfill this line item from',
    enum: SourceKind,
    example: SourceKind.SISTER,
  })
  @IsEnum(SourceKind)
  @IsNotEmpty()
  newSourceKind: SourceKind;

  @ApiProperty({
    description: 'New source name — e.g. "FTG Parts" or "Repco"',
    example: 'FTG Parts',
  })
  @IsString()
  @IsNotEmpty()
  newSourceName: string;

  @ApiPropertyOptional({
    description: 'New source rooftop precinct ID if SISTER source',
    example: 'ROOFTOP-FTG',
  })
  @IsOptional()
  @IsString()
  newSourceRooftopId?: string;

  @ApiPropertyOptional({
    description: 'Updated bin location at new source warehouse',
    example: 'B-04-12',
  })
  @IsOptional()
  @IsString()
  newBinLocation?: string;

  @ApiPropertyOptional({
    description:
      'Updated unit trade price in AUD cents if source price differs',
    example: 8900,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  newUnitPriceCents?: number;

  @ApiPropertyOptional({
    description: 'Updated delivery / arrival ETA string',
    example: 'Tomorrow 9:00 AM transfer',
  })
  @IsOptional()
  @IsString()
  newEta?: string;

  @ApiPropertyOptional({
    description: 'Controller notes regarding the re-sourcing decision',
    example: 'Re-routed from Dandenong to FTG branch due to local stock out',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
