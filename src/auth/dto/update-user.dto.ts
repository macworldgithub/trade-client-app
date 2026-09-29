import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../common/enums/roles.enum';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'John Smith' })
  @IsString()
  @IsOptional()
  fullName?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @ApiPropertyOptional({ example: 'ACC-001' })
  @IsString()
  @IsOptional()
  tradeAccountId?: string;

  @ApiPropertyOptional({ example: 'ROOFTOP-DANDENONG' })
  @IsString()
  @IsOptional()
  rooftopId?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  creditHold?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isOverdue?: boolean;
}
