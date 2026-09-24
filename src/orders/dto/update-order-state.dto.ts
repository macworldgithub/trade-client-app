import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderState } from '../enums/order-state.enum';

export class UpdateOrderStateDto {
  @ApiProperty({
    description: 'Target order lifecycle state',
    enum: OrderState,
    example: OrderState.PROCESSING,
  })
  @IsEnum(OrderState)
  @IsNotEmpty()
  state: OrderState;

  @ApiPropertyOptional({
    description: 'Optional note or reason for the state transition',
    example: 'Allocated to warehouse picker John D.',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
