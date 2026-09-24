import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateOverdueDto {
  @ApiProperty({
    description: 'Set to true to mark the account as overdue, false to clear it.',
    example: true,
  })
  @IsBoolean()
  isOverdue: boolean;
}
