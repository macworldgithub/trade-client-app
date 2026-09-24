import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LineExceptionReason } from '../enums/line-exception-reason.enum';

export class RaiseLineExceptionDto {
  @ApiProperty({
    description: 'Category / reason for the line exception',
    enum: LineExceptionReason,
    example: LineExceptionReason.OUT_OF_STOCK,
  })
  @IsEnum(LineExceptionReason)
  @IsNotEmpty()
  reason: LineExceptionReason;

  @ApiProperty({
    description: 'Detailed explanation of the issue encountered',
    example: 'Bin A-12-03 is empty, physical stock count is 0',
  })
  @IsString()
  @IsNotEmpty()
  description: string;
}
