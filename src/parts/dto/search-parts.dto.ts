import {
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for GET /parts/search
 *
 * At least one of q, franchise, or vehicle must be supplied — this is
 * enforced in the service layer rather than the DTO so the error message
 * can be domain-specific.
 *
 * Example:
 *   GET /api/v1/parts/search?q=04465-0D060&franchise=TOYOTA&rooftopId=ROOFTOP-DANDENONG
 *   GET /api/v1/parts/search?q=brake+pad&vehicle=COROLLA&rooftopId=ROOFTOP-DANDENONG
 */
export class SearchPartsDto {
  /**
   * Free-text search string — matched against OEM part number, description,
   * and keyword synonyms. Accepts a raw OEM part number (with or without
   * hyphens) or plain-English keywords.
   * Min 2 chars to prevent full-catalogue scans.
   */
  @ApiPropertyOptional({
    description:
      'OEM part number (e.g. "04465-0D060") or keyword (e.g. "brake pad"). ' +
      'Min 2 characters.',
    example: '04465-0D060',
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Search query must be at least 2 characters' })
  @MaxLength(100, { message: 'Search query must be 100 characters or fewer' })
  q?: string;

  /**
   * OEM brand code filter — restricts results to parts belonging to this
   * franchise. Must match a Franchise.brandCode value.
   * e.g. "TOYOTA", "MITSUBISHI"
   */
  @ApiPropertyOptional({
    description:
      'OEM brand / franchise code to filter by — e.g. "TOYOTA". ' +
      'Must match an active Franchise.brandCode.',
    example: 'TOYOTA',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  franchise?: string;

  /**
   * Vehicle model filter — restricts results to parts with a matching entry
   * in Part.vehicleFitment. Case-insensitive; normalised before querying.
   * e.g. "COROLLA", "RAV4", "TRITON"
   */
  @ApiPropertyOptional({
    description:
      'Vehicle model to filter fitment by — e.g. "COROLLA". ' +
      'Matched case-insensitively against Part.vehicleFitment.',
    example: 'COROLLA',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicle?: string;

  /**
   * Rooftop context for the search — used to scope franchise availability
   * and to log the search against the correct precinct in the audit trail.
   * e.g. "ROOFTOP-DANDENONG"
   */
  @ApiPropertyOptional({
    description:
      'Rooftop slug for precinct-scoped search context — e.g. "ROOFTOP-DANDENONG".',
    example: 'ROOFTOP-DANDENONG',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  rooftopId?: string;

  /**
   * Maximum number of results to return. Defaults to 20, capped at 100.
   * Use in conjunction with page for pagination.
   */
  @ApiPropertyOptional({
    description: 'Page size — defaults to 20, max 100.',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /**
   * 1-based page number for pagination. Defaults to 1.
   */
  @ApiPropertyOptional({
    description: '1-based page number — defaults to 1.',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
}
