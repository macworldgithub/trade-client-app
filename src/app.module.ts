import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RooftopsModule } from './rooftops/rooftops.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI as string,
      }),
    }),
    AuthModule,
    RooftopsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
