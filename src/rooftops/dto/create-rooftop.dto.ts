import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsArray,
  ArrayUnique,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRooftopDto {
  @ApiProperty({
    example: 'ROOFTOP-DANDENONG',
    description:
      'Unique slug used as the canonical external ID — stored on User.rooftopId and referenced by all other modules',
  })
  @IsString()
  @IsNotEmpty()
  rooftopId: string;

  @ApiProperty({ example: 'Booran Dandenong' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 'DAN',
    description: 'Short reporting code — 2–6 upper-case letters',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{2,6}$/, {
    message: 'code must be 2–6 upper-case letters (e.g. "DAN")',
  })
  code: string;

  // ─── Location ─────────────────────────────────────────────────────────────

  @ApiProperty({ example: '147 Lathams Road' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'Carrum Downs' })
  @IsString()
  @IsNotEmpty()
  suburb: string;

  @ApiProperty({ example: 'VIC' })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiProperty({ example: '3201' })
  @IsString()
  @IsNotEmpty()
  postcode: string;

  @ApiPropertyOptional({ example: '+61 3 9793 9999' })
  @IsString()
  @IsOptional()
  phone?: string;

  // ─── Operational ──────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: 'DAN01',
    description: 'Pentana DMS site code for this precinct',
  })
  @IsString()
  @IsOptional()
  pentanaSiteCode?: string;

  @ApiPropertyOptional({
    example: ['TOYOTA', 'LEXUS'],
    description: 'OEM brand codes active at this precinct',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @IsOptional()
  oemBrandCodes?: string[];

  @ApiPropertyOptional({
    example: '+10:00',
    description: 'UTC offset for local trading-hours display',
    default: '+10:00',
  })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
