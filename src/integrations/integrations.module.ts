import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PentanaDmsService } from './pentana-dms.service';
import { OemPortalService } from './oem-portal.service';
import { PartsCheckClientService } from './partscheck-client.service';
import { CapricornService } from './capricorn.service';
import { EraPowerAutomationService } from './erapower-automation.service';
import { PartsCheckAutomationService } from './partscheck-automation.service';
import { Part, PartSchema } from '../parts/schemas/part.schema';
import { TradeAccount, TradeAccountSchema } from '../accounts/schemas/account.schema';
import { Rooftop, RooftopSchema } from '../rooftops/schemas/rooftop.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Part.name, schema: PartSchema },
      { name: TradeAccount.name, schema: TradeAccountSchema },
      { name: Rooftop.name, schema: RooftopSchema },
    ]),
  ],
  providers: [
    EraPowerAutomationService,
    PartsCheckAutomationService,
    PentanaDmsService,
    OemPortalService,
    PartsCheckClientService,
    CapricornService,
  ],
  exports: [
    EraPowerAutomationService,
    PartsCheckAutomationService,
    PentanaDmsService,
    OemPortalService,
    PartsCheckClientService,
    CapricornService,
  ],
})
export class IntegrationsModule {}
