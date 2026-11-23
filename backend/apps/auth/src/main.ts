import { NestFactory } from '@nestjs/core';
import supertokens from 'supertokens-node';
import { SuperTokensExceptionFilter } from 'supertokens-nestjs';
import { AuthModule } from './auth.module';
import { appInfo } from './supertokens-config';
import { middleware } from 'supertokens-node/framework/express';

async function bootstrap() {
  const app = await NestFactory.create(AuthModule);

  app.enableCors({
    origin: [appInfo.websiteDomain],
    allowedHeaders: ['content-type', ...supertokens.getAllCORSHeaders()],
    credentials: true,
  });
  app.useGlobalFilters(new SuperTokensExceptionFilter());
  app.use(middleware());

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
