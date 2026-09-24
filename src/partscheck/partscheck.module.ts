import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { PartsCheckController } from './partscheck.controller';
import { PartsCheckService } from './partscheck.service';
import {
  PartsCheckRfq,
  PartsCheckRfqSchema,
} from './schemas/partscheck-rfq.schema';
import {
  TradeAccount,
  TradeAccountSchema,
} from '../accounts/schemas/account.schema';
import { Rooftop, RooftopSchema } from '../rooftops/schemas/rooftop.schema';
import { Part, PartSchema } from '../parts/schemas/part.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import {
  AuditEvent,
  AuditEventSchema,
} from '../auth/schemas/audit-event.schema';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    MongooseModule.forFeature([
      { name: PartsCheckRfq.name, schema: PartsCheckRfqSchema },
      { name: TradeAccount.name, schema: TradeAccountSchema },
      { name: Rooftop.name, schema: RooftopSchema },
      { name: Part.name, schema: PartSchema },
      { name: Order.name, schema: OrderSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  controllers: [PartsCheckController],
  providers: [PartsCheckService],
  exports: [PartsCheckService, MongooseModule],
})
export class PartsCheckModule {}
