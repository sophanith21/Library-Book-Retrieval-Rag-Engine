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
        // Manual acks: the controller acks only after a message is fully
        // processed. Several messages may be in flight so quick reads
        // (status, stats) are answered while a book is indexing; the
        // controller still runs write jobs strictly one at a time.
        noAck: false,
        prefetchCount: 10,
      },
    },
  );
  app.enableShutdownHooks();
  await app.listen();
}
void bootstrap();
