import { NestFactory } from '@nestjs/core';
import { IndexingModule } from './indexing.module';

async function bootstrap() {
  const app = await NestFactory.create(IndexingModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
