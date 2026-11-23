import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SuperTokensModule } from 'supertokens-nestjs';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { supertokensConfig } from './supertokens-config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    SuperTokensModule.forRoot(supertokensConfig),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
