import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { TrackedCnpjsModule } from './tracked-cnpjs/tracked-cnpjs.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ScraperModule } from './scraper/scraper.module';
import { ConfigModule } from '@nestjs/config';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // BullModule.forRoot({
    //   connection: {
    //     host: redisHost,
    //     port: redisPort,
    //     lazyConnect: true,
    //     enableOfflineQueue: false,
    //     connectTimeout: 1000,
    //     maxRetriesPerRequest: null,
    //     retryStrategy: () => null,
    //   } as any,
    // }),
    // ScheduleModule.forRoot(),
    AuthModule,
    PrismaModule,
    OrganizationsModule,
    TrackedCnpjsModule,
    InstrumentsModule,
    // ScraperModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

