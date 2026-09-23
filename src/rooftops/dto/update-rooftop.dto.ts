import { PartialType } from '@nestjs/swagger';
import { CreateRooftopDto } from './create-rooftop.dto';

/**
 * All fields are optional for PATCH semantics.
 * PartialType (from @nestjs/swagger) marks every inherited field optional
 * and preserves the Swagger / class-validator decorators.
 * rooftopId is intentionally kept editable so a slug can be corrected by
 * group_admin before any other module has adopted it.
 */
export class UpdateRooftopDto extends PartialType(CreateRooftopDto) {}
