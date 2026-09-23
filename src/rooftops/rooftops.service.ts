import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Rooftop, RooftopDocument } from './schemas/rooftop.schema';
import { Franchise, FranchiseDocument } from './schemas/franchise.schema';
import { FeedHealth, FeedHealthDocument } from './schemas/feed-health.schema';
import { CreateRooftopDto } from './dto/create-rooftop.dto';
import { UpdateRooftopDto } from './dto/update-rooftop.dto';

@Injectable()
export class RooftopsService {
  constructor(
    @InjectModel(Rooftop.name) private rooftopModel: Model<RooftopDocument>,
    @InjectModel(Franchise.name)
    private franchiseModel: Model<FranchiseDocument>,
    @InjectModel(FeedHealth.name)
    private feedHealthModel: Model<FeedHealthDocument>,
  ) {}

  // ─── GET /rooftops ────────────────────────────────────────────────────────

  async findAll(): Promise<RooftopDocument[]> {
    return this.rooftopModel.find().sort({ name: 1 }).lean().exec();
  }

  // ─── GET /rooftops/:id ────────────────────────────────────────────────────

  async findOne(rooftopId: string): Promise<RooftopDocument> {
    const rooftop = await this.rooftopModel
      .findOne({ rooftopId })
      .lean()
      .exec();

    if (!rooftop) {
      throw new NotFoundException(`Rooftop '${rooftopId}' not found`);
    }

    return rooftop;
  }

  // ─── GET /rooftops/:id/franchises ─────────────────────────────────────────

  async findFranchises(rooftopId: string): Promise<FranchiseDocument[]> {
    // Ensure parent rooftop exists first
    await this.findOne(rooftopId);

    return this.franchiseModel
      .find({ rooftopId })
      .sort({ brandName: 1 })
      .lean()
      .exec();
  }

  // ─── GET /rooftops/:id/feed-health ────────────────────────────────────────

  async findFeedHealth(rooftopId: string): Promise<FeedHealthDocument[]> {
    // Ensure parent rooftop exists first
    await this.findOne(rooftopId);

    return this.feedHealthModel
      .find({ rooftopId })
      .sort({ feedType: 1, brandCode: 1 })
      .lean()
      .exec();
  }

  // ─── POST /rooftops ───────────────────────────────────────────────────────

  async create(dto: CreateRooftopDto): Promise<RooftopDocument> {
    // Guard against duplicate slug
    const existing = await this.rooftopModel
      .findOne({
        $or: [{ rooftopId: dto.rooftopId }, { code: dto.code }],
      })
      .lean()
      .exec();

    if (existing) {
      const field =
        existing.rooftopId === dto.rooftopId ? 'rooftopId' : 'code';
      throw new ConflictException(
        `A rooftop with that ${field} already exists`,
      );
    }

    const rooftop = await this.rooftopModel.create({
      rooftopId: dto.rooftopId,
      name: dto.name,
      code: dto.code,
      address: dto.address,
      suburb: dto.suburb,
      state: dto.state,
      postcode: dto.postcode,
      phone: dto.phone ?? null,
      pentanaSiteCode: dto.pentanaSiteCode ?? null,
      oemBrandCodes: dto.oemBrandCodes ?? [],
      timezone: dto.timezone ?? '+10:00',
      isActive: dto.isActive ?? true,
    });

    return rooftop;
  }

  // ─── PATCH /rooftops/:id ──────────────────────────────────────────────────

  async update(
    rooftopId: string,
    dto: UpdateRooftopDto,
  ): Promise<RooftopDocument> {
    // Confirm the rooftop exists
    await this.findOne(rooftopId);

    // If the caller is changing the slug or code, check for collisions
    if (dto.rooftopId || dto.code) {
      const collision = await this.rooftopModel
        .findOne({
          rooftopId: { $ne: rooftopId }, // exclude self
          $or: [
            ...(dto.rooftopId ? [{ rooftopId: dto.rooftopId }] : []),
            ...(dto.code ? [{ code: dto.code }] : []),
          ],
        })
        .lean()
        .exec();

      if (collision) {
        const field =
          collision.rooftopId === dto.rooftopId ? 'rooftopId' : 'code';
        throw new ConflictException(
          `Another rooftop already uses that ${field}`,
        );
      }
    }

    const updated = await this.rooftopModel
      .findOneAndUpdate(
        { rooftopId },
        { $set: dto },
        { new: true, runValidators: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(`Rooftop '${rooftopId}' not found`);
    }

    return updated;
  }
}
