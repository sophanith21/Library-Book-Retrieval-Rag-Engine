import { initTelemetry, OtelLogger } from '@app/observability';

initTelemetry('indexing');

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { QUEUES } from '@app/contracts';
import { IndexingModule } from './indexing.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    IndexingModule,
    {
      logger: new OtelLogger('indexing'),
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
        queue: QUEUES.INDEXING,
        queueOptions: { durable: true },
        // Manual acks + one message at a time: indexing is write-heavy and
        // the controller acks only after a book is fully processed.
        noAck: false,
        prefetchCount: 1,
      },
    },
  );
  app.enableShutdownHooks();
  await app.listen();
}
void bootstrap();
