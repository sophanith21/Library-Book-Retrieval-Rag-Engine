import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  AuthResponse,
  AuthUser,
  LoginDto,
  PATTERNS,
  RegisterDto,
  SERVICES,
} from '@app/contracts';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentToken } from './current-token.decorator';
import { rpc } from './rpc-client';

@Controller('auth')
export class AuthGatewayController {
  constructor(@Inject(SERVICES.AUTH) private readonly client: ClientProxy) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.send<AuthResponse>(PATTERNS.AUTH.REGISTER, dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.send<AuthResponse>(PATTERNS.AUTH.LOGIN, dto);
  }

  /** Current user for `Authorization: Bearer <accessToken>`. */
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentToken() accessToken?: string): Promise<AuthUser> {
    if (!accessToken) {
      throw new UnauthorizedException('Missing bearer token');
    }

    return this.send<AuthUser>(PATTERNS.AUTH.VALIDATE, { accessToken });
  }

  private send<T>(pattern: string, payload: unknown): Promise<T> {
    return rpc<T>(this.client, pattern, payload, { service: 'Auth' });
  }
}
