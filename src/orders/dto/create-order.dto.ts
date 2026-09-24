import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  IsEnum,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SourceKind } from '../../parts/schemas/part-source.schema';
import { DeliveryMethod } from '../enums/delivery-method.enum';

export class CreateOrderLineDto {
  @ApiProperty({
    description: 'OEM part number — e.g. "04465-0D060"',
    example: '04465-0D060',
  })
  @IsString()
  @IsNotEmpty()
  partNumber: string;

  @ApiPropertyOptional({
    description: 'OEM brand code — e.g. "TOYOTA"',
    example: 'TOYOTA',
  })
  @IsOptional()
  @IsString()
  brandCode?: string;

  @ApiPropertyOptional({
    description: 'Part description text',
    example: 'FRONT BRAKE PAD SET',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Order quantity (minimum 1)',
    example: 2,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description: 'Trade price in AUD cents per unit',
    example: 8550,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitPriceCents?: number;

  @ApiPropertyOptional({
    description: 'Core charge in AUD cents per unit',
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  coreChargeCents?: number;

  @ApiPropertyOptional({
    description: 'Tier tier chosen from federated resolver',
    enum: SourceKind,
    example: SourceKind.BRANCH,
  })
  @IsOptional()
  @IsEnum(SourceKind)
  sourceKind?: SourceKind;

  @ApiPropertyOptional({
    description: 'Source descriptor name (e.g. "Dandenong Parts")',
    example: 'Dandenong Parts',
  })
  @IsOptional()
  @IsString()
  sourceName?: string;

  @ApiPropertyOptional({
    description: 'Source rooftop ID if sister branch',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  sourceRooftopId?: string;

  @ApiPropertyOptional({
    description: 'Bin location at warehouse',
    example: 'A-12-03',
  })
  @IsOptional()
  @IsString()
  binLocation?: string;

  @ApiPropertyOptional({
    description: 'Estimated time of arrival / delivery note',
    example: 'Same day',
  })
  @IsOptional()
  @IsString()
  eta?: string;
}

export class CreateOrderDto {
  @ApiPropertyOptional({
    description:
      'Destination / servicing rooftop precinct slug. If omitted, uses user profile default.',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  rooftopId?: string;

  @ApiPropertyOptional({
    description:
      'Trade account ID (only allowed for staff overrides; trade partners use their own account automatically)',
    example: 'ACC-000123',
  })
  @IsOptional()
  @IsString()
  tradeAccountId?: string;

  @ApiPropertyOptional({
    description: 'Workshop purchase order number or vehicle rego reference',
    example: 'PO-99482-COROLLA',
  })
  @IsOptional()
  @IsString()
  customerReference?: string;

  @ApiPropertyOptional({
    description: 'Delivery method',
    enum: DeliveryMethod,
    default: DeliveryMethod.DELIVERY,
    example: DeliveryMethod.DELIVERY,
  })
  @IsOptional()
  @IsEnum(DeliveryMethod)
  deliveryMethod?: DeliveryMethod;

  @ApiPropertyOptional({
    description: 'Delivery destination street address',
    example: '123 Workshop Lane, Dandenong South VIC 3175',
  })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional({
    description: 'Special delivery instructions / gate code / contact note',
    example: 'Deliver to rear bay 3, ask for Dave',
  })
  @IsOptional()
  @IsString()
  deliveryNotes?: string;

  @ApiProperty({
    description: 'Array of line items to order (at least 1 required)',
    type: [CreateOrderLineDto],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Order must contain at least one line item' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines: CreateOrderLineDto[];
}
