import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class TriggerQuoteDto {
  @ApiPropertyOptional({
    description: 'Optional controller notes or override justification',
    example: 'Manual quote approved after checking supplier stock directly',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
