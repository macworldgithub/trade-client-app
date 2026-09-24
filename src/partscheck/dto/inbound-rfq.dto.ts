import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsInt,
  Min,
  IsDateString,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VehicleDetailsDto {
  @ApiPropertyOptional({ example: 'Toyota' })
  @IsOptional()
  @IsString()
  make?: string;

  @ApiPropertyOptional({ example: 'Corolla' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: 2022 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ example: '6T1BF3EK40X000123' })
  @IsOptional()
  @IsString()
  vin?: string;

  @ApiPropertyOptional({ example: 'ABC-123' })
  @IsOptional()
  @IsString()
  rego?: string;
}

export class InboundRfqLineDto {
  @ApiPropertyOptional({
    description: 'PartsCheck line identifier (e.g. "PC-LIN-01")',
    example: 'PC-LIN-01',
  })
  @IsOptional()
  @IsString()
  lineId?: string;

  @ApiProperty({
    description: 'OEM or aftermarket requested part number',
    example: '04465-0D060',
  })
  @IsString()
  @IsNotEmpty()
  partNumber: string;

  @ApiPropertyOptional({
    description: 'Part description text',
    example: 'FRONT BRAKE PAD SET',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Requested quantity',
    example: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}

export class InboundRfqDto {
  @ApiProperty({
    description: 'Unique PartsCheck external RFQ ID',
    example: 'PC-RFQ-10293',
  })
  @IsString()
  @IsNotEmpty()
  rfqId: string;

  @ApiProperty({
    description: 'PartsCheck repairer / buyer identifier',
    example: 'BUYER-SMASH-01',
  })
  @IsString()
  @IsNotEmpty()
  buyerId: string;

  @ApiProperty({
    description: 'Repairer / workshop trading company name',
    example: 'Dandenong Smash Repairs',
  })
  @IsString()
  @IsNotEmpty()
  repairerName: string;

  @ApiPropertyOptional({
    description: 'Repairer contact email address',
    example: 'parts@dandenongsmash.com.au',
  })
  @IsOptional()
  @IsString()
  repairerEmail?: string;

  @ApiPropertyOptional({
    description: 'Repairer contact phone number',
    example: '+61 3 9700 0000',
  })
  @IsOptional()
  @IsString()
  repairerPhone?: string;

  @ApiPropertyOptional({
    description: 'Servicing rooftop slug (if specified by PartsCheck routing)',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  rooftopId?: string;

  @ApiPropertyOptional({
    description: 'Pre-matched Pentana trade account ID if known',
    example: 'ACC-000123',
  })
  @IsOptional()
  @IsString()
  tradeAccountId?: string;

  @ApiPropertyOptional({
    description: 'Insurance claim reference number',
    example: 'CLM-2026-99128',
  })
  @IsOptional()
  @IsString()
  claimNumber?: string;

  @ApiPropertyOptional({
    description: 'Internal repair order number',
    example: 'RO-55421',
  })
  @IsOptional()
  @IsString()
  repairOrderNumber?: string;

  @ApiPropertyOptional({
    description: 'Vehicle information block',
    type: VehicleDetailsDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => VehicleDetailsDto)
  vehicleDetails?: VehicleDetailsDto;

  @ApiProperty({
    description: 'PartsCheck quote submission cutoff deadline (ISO string)',
    example: '2026-09-24T18:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  deadline: string;

  @ApiProperty({
    description: 'Array of requested line items (at least 1 required)',
    type: [InboundRfqLineDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InboundRfqLineDto)
  lines: InboundRfqLineDto[];
}
