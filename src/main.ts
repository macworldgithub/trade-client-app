import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureHttp } from './configure-http';

// Global WebSocket fallback for Node.js < 22 environments
if (typeof (globalThis as any).WebSocket === 'undefined') {
  (globalThis as any).WebSocket = class NoOpWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 3;
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return false;
    }
    send() {}
    close() {}
  };
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();
  configureHttp(app);

  // Swagger API Documentation setup
  const enableSwagger = process.env.SWAGGER_ENABLED !== 'false';
  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('Trade Client App API')
      .setDescription('Booran Motor Group — Trade Client Easy Order API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = parseInt(process.env.PORT || '4050', 10);
  const host = process.env.HOST || '0.0.0.0';

  await app.listen(port, host);
  logger.log(`Application successfully started on: http://${host}:${port}`);
  logger.log(`API Base URL: http://${host}:${port}/api/v1`);
  logger.log(`Health Check: http://${host}:${port}/health`);
  if (enableSwagger) {
    logger.log(`Swagger Documentation: http://${host}:${port}/docs`);
  }
}
bootstrap();

