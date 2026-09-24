import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order, OrderSchema } from './schemas/order.schema';
import { AccountsModule } from '../accounts/accounts.module';
import {
  TradeAccount,
  TradeAccountSchema,
} from '../accounts/schemas/account.schema';
import { Rooftop, RooftopSchema } from '../rooftops/schemas/rooftop.schema';
import { Part, PartSchema } from '../parts/schemas/part.schema';
import { User, UserSchema } from '../auth/schemas/user.schema';
import {
  AuditEvent,
  AuditEventSchema,
} from '../auth/schemas/audit-event.schema';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    AccountsModule,
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: TradeAccount.name, schema: TradeAccountSchema },
      { name: Rooftop.name, schema: RooftopSchema },
      { name: Part.name, schema: PartSchema },
      { name: User.name, schema: UserSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService, MongooseModule],
})
export class OrdersModule {}
