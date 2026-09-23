import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { RooftopsService } from './rooftops.service';
import { RooftopsController } from './rooftops.controller';
import { Rooftop, RooftopSchema } from './schemas/rooftop.schema';
import { Franchise, FranchiseSchema } from './schemas/franchise.schema';
import { FeedHealth, FeedHealthSchema } from './schemas/feed-health.schema';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    MongooseModule.forFeature([
      { name: Rooftop.name, schema: RooftopSchema },
      { name: Franchise.name, schema: FranchiseSchema },
      { name: FeedHealth.name, schema: FeedHealthSchema },
    ]),
  ],
  controllers: [RooftopsController],
  providers: [RooftopsService],
  exports: [RooftopsService, MongooseModule], // Export so other modules can scope queries by rooftopId
})
export class RooftopsModule {}
