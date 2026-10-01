import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import express, { Express, Request, Response } from 'express';

let cachedServer: Express;

async function bootstrapServer(): Promise<Express> {
  if (!cachedServer) {
    const expressApp = express();
    const app = await NestFactory.create(
      AppModule,
      new ExpressAdapter(expressApp),
    );

    app.setGlobalPrefix('api/v1', {
      exclude: ['/', 'health'],
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    app.enableCors({
      origin: true,
      credentials: true,
    });

    await app.init();
    cachedServer = expressApp;
  }
  return cachedServer;
}

export default async function handler(req: Request, res: Response) {
  try {
    const server = await bootstrapServer();
    return server(req, res);
  } catch (error: any) {
    console.error('Vercel Serverless Function Error:', error);
    return res.status(500).json({
      statusCode: 500,
      message: 'Serverless Function Execution Error',
      error: error?.message || String(error),
      details: 'Check Vercel Environment Variables (MONGODB_URI, SUPABASE_URL, SUPABASE_SECRET_KEY) and MongoDB Atlas IP access list.',
    });
  }
}

