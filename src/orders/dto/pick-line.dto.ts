import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PickLineDto {
  @ApiPropertyOptional({
    description:
      'Picked quantity in units. Defaults to the ordered line quantity if omitted.',
    example: 2,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pickedQuantity?: number;

  @ApiPropertyOptional({
    description: 'Physical bin location verified by the picker',
    example: 'A-12-03',
  })
  @IsOptional()
  @IsString()
  binLocationConfirmed?: string;

  @ApiPropertyOptional({
    description: 'Picker notes or batch serial info',
    example: 'Picked from top shelf batch #882',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
