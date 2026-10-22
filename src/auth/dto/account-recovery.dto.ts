import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MinLength, MaxLength } from 'class-validator';

export class AccountEmailDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  email: string;
}

export class AccountTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{64}$/)
  token: string;
}

export class ResetPasswordDto extends AccountTokenDto {
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password: string;
}

export class EmailOtpChallengeDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{64}$/)
  challengeId: string;
}

export class VerifyEmailOtpDto extends EmailOtpChallengeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
