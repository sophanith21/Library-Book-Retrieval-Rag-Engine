import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ApiGatewayModule } from './api-gateway.module';

async function bootstrap() {
  const app =
    await NestFactory.create<NestExpressApplication>(ApiGatewayModule);
  // A whole book's chunks arrive in one POST /indexing body (several MB for
  // long novels); Express's default JSON limit is 100 KB.
  app.useBodyParser('json', { limit: '50mb' });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
