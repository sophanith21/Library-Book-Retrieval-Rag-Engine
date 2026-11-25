import { initTelemetry, OtelLogger } from '@app/observability';

initTelemetry('book');

import { NestFactory } from '@nestjs/core';
import { BookModule } from './book.module';

async function bootstrap() {
  const app = await NestFactory.create(BookModule, {
    logger: new OtelLogger('book'),
  });
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
