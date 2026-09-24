import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCreditHoldDto {
  @ApiProperty({
    description: 'Set to true to place the account on credit hold, false to release it.',
    example: true,
  })
  @IsBoolean()
  creditHold: boolean;
}
