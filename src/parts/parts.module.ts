import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { PartsController } from './parts.controller';
import { PartsService } from './parts.service';
import { Part, PartSchema } from './schemas/part.schema';
import { PartSource, PartSourceSchema } from './schemas/part-source.schema';
// Cross-module schema imports — no circular dependency: we import schemas
// directly rather than the feature modules, matching the pattern used by
// AccountsModule and RooftopsModule.
import { Rooftop, RooftopSchema } from '../rooftops/schemas/rooftop.schema';
import {
  TradeAccount,
  TradeAccountSchema,
} from '../accounts/schemas/account.schema';
import {
  AuditEvent,
  AuditEventSchema,
} from '../auth/schemas/audit-event.schema';

@Module({
  imports: [
    // Register 'jwt' as the default Passport strategy so JwtAuthGuard works
    PassportModule.register({ defaultStrategy: 'jwt' }),

    MongooseModule.forFeature([
      // Own schemas
      { name: Part.name, schema: PartSchema },
      { name: PartSource.name, schema: PartSourceSchema },

      // Cross-module schemas accessed directly (no circular module import)
      { name: Rooftop.name, schema: RooftopSchema },
      { name: TradeAccount.name, schema: TradeAccountSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  controllers: [PartsController],
  providers: [PartsService],
  exports: [PartsService],
})
export class PartsModule {}
