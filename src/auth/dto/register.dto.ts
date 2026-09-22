import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../common/enums/roles.enum';

export class RegisterDto {
  @ApiProperty({ example: 'john@workshop.com.au' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'John Smith' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({ enum: Role, default: Role.TRADE_PARTNER })
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
}
