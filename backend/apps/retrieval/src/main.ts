import { initTelemetry, OtelLogger } from '@app/observability';

initTelemetry('retrieval');

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { QUEUES } from '@app/contracts';
import { RetrievalModule } from './retrieval.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    RetrievalModule,
    {
      logger: new OtelLogger('retrieval'),
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
        queue: QUEUES.RETRIEVAL,
        queueOptions: { durable: true },
      },
    },
  );
  app.enableShutdownHooks();
  await app.listen();
}
void bootstrap();
