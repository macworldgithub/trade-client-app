import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import {
  PartsCheckRfq,
  PartsCheckRfqSchema,
} from '../partscheck/schemas/partscheck-rfq.schema';
import {
  TradeAccount,
  TradeAccountSchema,
} from '../accounts/schemas/account.schema';
import { Rooftop, RooftopSchema } from '../rooftops/schemas/rooftop.schema';
import {
  AuditEvent,
  AuditEventSchema,
} from '../auth/schemas/audit-event.schema';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: PartsCheckRfq.name, schema: PartsCheckRfqSchema },
      { name: TradeAccount.name, schema: TradeAccountSchema },
      { name: Rooftop.name, schema: RooftopSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService, MongooseModule],
})
export class DashboardModule {}
