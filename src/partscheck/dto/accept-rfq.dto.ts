import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryMethod } from '../../orders/enums/delivery-method.enum';

export class AcceptRfqDto {
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
    example: '123 Repair Street, Dandenong VIC 3175',
  })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional({
    description: 'Delivery notes / contact details',
    example: 'Deliver to spray booth area, contact John',
  })
  @IsOptional()
  @IsString()
  deliveryNotes?: string;
}
