import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for GET /parts/:partNumber/resolve
 *
 * Both rooftopId and accountId are required for a meaningful federated
 * resolution — the resolver needs the rooftop to locate own-branch and
 * sister-branch stock, and the account to compute trade pricing.
 *
 * Example:
 *   GET /api/v1/parts/04465-0D060/resolve?rooftopId=ROOFTOP-DANDENONG&accountId=ACC-000123
 */
export class ResolvePartDto {
  /**
   * Rooftop slug for the requesting precinct.
   * The resolver uses this to identify own-branch stock first, then
   * fan out to sister branches within the same motor group.
   * e.g. "ROOFTOP-DANDENONG"
   */
  @ApiProperty({
    description:
      'Rooftop slug of the requesting precinct — e.g. "ROOFTOP-DANDENONG". ' +
      'Determines own-branch vs sister-branch stock priority.',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(60)
  rooftopId: string;

  /**
   * Pentana trade account ID of the requesting customer.
   * Used to compute account-level trade pricing (discount tier applied
   * to list price to yield tradePriceCents on each PartSource row).
   * e.g. "ACC-000123"
   */
  @ApiProperty({
    description:
      'Pentana trade account ID — e.g. "ACC-000123". ' +
      'Used to calculate account-level trade pricing.',
    example: 'ACC-000123',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  accountId: string;

  /**
   * Optional OEM brand code hint.
   * When supplied, the resolver skips the brand-detection step and routes
   * directly to the correct OEM feed. Useful when the caller already knows
   * the franchise from the search results.
   * e.g. "TOYOTA"
   */
  @ApiPropertyOptional({
    description:
      'OEM brand code hint — e.g. "TOYOTA". Skips brand-detection when supplied.',
    example: 'TOYOTA',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  brandCode?: string;
}
