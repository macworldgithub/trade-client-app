import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RooftopsModule } from './rooftops/rooftops.module';
import { AccountsModule } from './accounts/accounts.module';
import { PartsModule } from './parts/parts.module';
import { OrdersModule } from './orders/orders.module';
import { AuditModule } from './audit/audit.module';
import { PartsCheckModule } from './partscheck/partscheck.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('MONGODB_URI') || process.env.MONGODB_URI;
        if (!uri) {
          console.error('CRITICAL: MONGODB_URI environment variable is missing!');
        }
        return {
          uri: uri || '',
          serverSelectionTimeoutMS: 5000,
        };
      },
      inject: [ConfigService],
    }),
    IntegrationsModule,
    AuthModule,
    RooftopsModule,
    AccountsModule,
    PartsModule,
    OrdersModule,
    AuditModule,
    PartsCheckModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
