import { NestFactory } from '@nestjs/core';
import { RetrievalModule } from './retrieval.module';

async function bootstrap() {
  const app = await NestFactory.create(RetrievalModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
