import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { TradeAccount, TradeAccountSchema } from './schemas/account.schema';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    MongooseModule.forFeature([
      { name: TradeAccount.name, schema: TradeAccountSchema },
    ]),
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
  // Export both so other modules (e.g. Orders) can inject AccountsService
  // directly and use assertNotOnCreditHold(), and can access the model if needed.
  exports: [AccountsService, MongooseModule],
})
export class AccountsModule {}
