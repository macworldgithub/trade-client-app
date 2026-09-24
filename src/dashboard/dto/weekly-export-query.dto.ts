import { IsEnum, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
}

export class WeeklyExportQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter export by rooftop precinct slug (if omitted, exports group-wide rollup)',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  rooftopId?: string;

  @ApiPropertyOptional({
    description: 'Export format (json or csv)',
    enum: ExportFormat,
    default: ExportFormat.JSON,
    example: ExportFormat.JSON,
  })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat = ExportFormat.JSON;

  @ApiPropertyOptional({
    description: 'Calendar year for the report (e.g. 2026)',
    example: 2026,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year?: number;

  @ApiPropertyOptional({
    description: 'Week number (1-53) or ISO date within target week',
    example: '2026-09-24',
  })
  @IsOptional()
  @IsString()
  week?: string;
}
