import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import express, { Express, Request, Response } from 'express';
import { configureHttp } from '../src/configure-http';

let cachedServer: Promise<Express> | undefined;

function bootstrapServer(): Promise<Express> {
  // Concurrent cold-start requests must share one application initialization.
  if (!cachedServer) cachedServer = createServer().catch(error => {
    cachedServer = undefined;
    throw error;
  });
  return cachedServer;
}

async function createServer(): Promise<Express> {
  const expressApp = express();
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
  );

  configureHttp(app);
  await app.init();
  return expressApp;
}

export default async function handler(req: Request, res: Response) {
  try {
    const server = await bootstrapServer();
    await new Promise<void>((resolve, reject) => {
      res.on('finish', () => resolve());
      res.on('close', () => resolve());
      res.on('error', (err) => reject(err));
      server(req, res);
    });
  } catch (error: any) {
    console.error('Vercel application initialization or request failed:', { name: error?.name, code: error?.code });
    if (res.headersSent) return;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '5');
    return res.status(503).json({
      statusCode: 503,
      message: 'The API is temporarily unavailable. Please retry shortly.',
    });
  }
}

