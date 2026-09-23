import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { RooftopsService } from './rooftops.service';
import { CreateRooftopDto } from './dto/create-rooftop.dto';
import { UpdateRooftopDto } from './dto/update-rooftop.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/roles.enum';

@ApiTags('Rooftops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)          // All rooftop endpoints require authentication
@Controller('rooftops')
export class RooftopsController {
  constructor(private readonly rooftopsService: RooftopsService) {}

  // ─── GET /rooftops ──────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List all precincts',
    description:
      'Returns all 9 precincts (rooftops) across the 24 Booran Motor Group addresses, sorted by name.',
  })
  @ApiResponse({ status: 200, description: 'Array of rooftop documents' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  findAll() {
    return this.rooftopsService.findAll();
  }

  // ─── GET /rooftops/:id ──────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Single precinct detail' })
  @ApiParam({
    name: 'id',
    description: 'rooftopId slug — e.g. "ROOFTOP-DANDENONG"',
  })
  @ApiResponse({ status: 200, description: 'Rooftop document' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'Rooftop not found' })
  findOne(@Param('id') id: string) {
    return this.rooftopsService.findOne(id);
  }

  // ─── GET /rooftops/:id/franchises ───────────────────────────────────────

  @Get(':id/franchises')
  @ApiOperation({
    summary: 'Brands / franchises at a precinct',
    description:
      'Returns the brand register for the given rooftop — each franchise carries its OEM feed endpoint and Pentana franchise code.',
  })
  @ApiParam({
    name: 'id',
    description: 'rooftopId slug — e.g. "ROOFTOP-DANDENONG"',
  })
  @ApiResponse({ status: 200, description: 'Array of franchise documents' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'Rooftop not found' })
  findFranchises(@Param('id') id: string) {
    return this.rooftopsService.findFranchises(id);
  }

  // ─── GET /rooftops/:id/feed-health ──────────────────────────────────────

  @Get(':id/feed-health')
  @ApiOperation({
    summary: 'Pentana + OEM feed health status for a precinct',
    description:
      'Returns the latest connectivity and sync status for every data feed (Pentana DMS and each OEM catalogue) at the given rooftop.',
  })
  @ApiParam({
    name: 'id',
    description: 'rooftopId slug — e.g. "ROOFTOP-DANDENONG"',
  })
  @ApiResponse({ status: 200, description: 'Array of feed-health documents' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 404, description: 'Rooftop not found' })
  findFeedHealth(@Param('id') id: string) {
    return this.rooftopsService.findFeedHealth(id);
  }

  // ─── POST /rooftops ─────────────────────────────────────────────────────

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.GROUP_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new rooftop (group_admin only)',
    description:
      'Adds a new precinct to the Booran Motor Group brand register. Only group_admin role may call this endpoint.',
  })
  @ApiResponse({ status: 201, description: 'Rooftop created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — group_admin required' })
  @ApiResponse({ status: 409, description: 'rooftopId or code already in use' })
  create(@Body() dto: CreateRooftopDto) {
    return this.rooftopsService.create(dto);
  }

  // ─── PATCH /rooftops/:id ────────────────────────────────────────────────

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.GROUP_ADMIN)
  @ApiOperation({
    summary: 'Update a rooftop (group_admin only)',
    description:
      'Partial update — only supplied fields are changed. group_admin role required.',
  })
  @ApiParam({
    name: 'id',
    description: 'rooftopId slug of the rooftop to update',
  })
  @ApiResponse({ status: 200, description: 'Updated rooftop document' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — group_admin required' })
  @ApiResponse({ status: 404, description: 'Rooftop not found' })
  @ApiResponse({ status: 409, description: 'rooftopId or code collision with existing rooftop' })
  update(@Param('id') id: string, @Body() dto: UpdateRooftopDto) {
    return this.rooftopsService.update(id, dto);
  }
}
