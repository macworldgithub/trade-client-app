import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditEvent,
  AuditEventDocument,
} from '../auth/schemas/audit-event.schema';
import { QueryAuditDto } from './dto/query-audit.dto';

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditEvent.name)
    private auditModel: Model<AuditEventDocument>,
  ) {}

  async findAll(query: QueryAuditDto): Promise<{
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    events: AuditEventDocument[];
  }> {
    const filter: Record<string, any> = {};

    if (query.userId) {
      filter.userId = query.userId;
    }

    if (query.rooftopId) {
      filter.rooftopId = query.rooftopId;
    }

    if (query.tradeAccountId) {
      filter.tradeAccountId = query.tradeAccountId;
    }

    if (query.action) {
      filter.action = query.action;
    }

    if (query.orderId) {
      const orderSearch = query.orderId.trim();
      filter.$or = [
        { 'metadata.orderId': orderSearch },
        { 'metadata.orderNumber': orderSearch },
        { 'metadata.orderId': { $regex: orderSearch, $options: 'i' } },
        { 'metadata.orderNumber': { $regex: orderSearch, $options: 'i' } },
      ];
    }

    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) {
        filter.createdAt.$gte = new Date(query.from);
      }
      if (query.to) {
        filter.createdAt.$lte = new Date(query.to);
      }
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const [total, events] = await Promise.all([
      this.auditModel.countDocuments(filter),
      this.auditModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      events,
    };
  }
}
