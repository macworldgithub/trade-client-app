import { IsString, Matches, IsUUID, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyTotpDto {
  @ApiProperty({ description: 'Opaque login challenge returned after password verification' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{64}$/)
  factorId: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^(\d{6}|[a-fA-F0-9]{5}(?:-?[a-fA-F0-9]{5}){3})$/)
  code: string;
}

export class EnrollTotpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password: string;
}

export class ConfirmTotpDto {
  @IsUUID()
  factorId: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class DisableTotpDto extends EnrollTotpDto {
  @IsString()
  @Matches(/^(\d{6}|[a-fA-F0-9]{5}(?:-?[a-fA-F0-9]{5}){3})$/)
  code: string;
}
