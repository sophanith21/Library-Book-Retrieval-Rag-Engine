import { initTelemetry, OtelLogger } from '@app/observability';

initTelemetry('api-gateway');

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { ApiGatewayModule } from './api-gateway.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    ApiGatewayModule,
    { logger: new OtelLogger('api-gateway') },
  );

  const httpLogger = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      httpLogger.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} - ${Date.now() - start}ms`,
      );
    });
    next();
  });

  // Allow large JSON payloads for book indexing
  app.useBodyParser('json', { limit: '50mb' });

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('Library Book Retrieval API')
    .setDescription(
      'API documentation for the Library Book Retrieval RAG Engine',
    )
    .setVersion('1.0')
    .addServer('/api', 'Edge Gateway')
    .addServer('/', 'Direct API Gateway')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);

  console.log('API Gateway running on port 3000');
  console.log('Swagger: http://localhost:3000/api/docs');
}

void bootstrap();
