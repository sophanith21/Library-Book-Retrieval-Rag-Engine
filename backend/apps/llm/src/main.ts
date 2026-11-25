import { initTelemetry, OtelLogger } from '@app/observability';

initTelemetry('llm');

import { NestFactory } from '@nestjs/core';
import { LlmModule } from './llm.module';

async function bootstrap() {
  const app = await NestFactory.create(LlmModule, {
    logger: new OtelLogger('llm'),
  });
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
