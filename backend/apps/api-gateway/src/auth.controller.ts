import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
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
import { firstValueFrom, TimeoutError, timeout } from 'rxjs';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentToken } from './current-token.decorator';


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

  private async send<T>(pattern: string, payload: unknown): Promise<T> {
    try {
      return await firstValueFrom(
        this.client.send<T>(pattern, payload).pipe(timeout(10_000)),
      );
    } catch (err) {
      throw toHttpException(err);
    }
  }
}


function toHttpException(err: unknown): HttpException {
  if (err instanceof TimeoutError) {
    return new HttpException(
      'Auth service timed out',
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }
  const body = authErrorBody(err);
  if (body) {
    return new HttpException(
      { statusCode: body.statusCode, message: body.message },
      body.statusCode,
    );
  }
  return new ServiceUnavailableException('Auth service unavailable');
}

function authErrorBody(
  err: unknown,
  depth = 0,
): { statusCode: number; message: string } | undefined {
  if (!err || typeof err !== 'object' || depth > 3) return undefined;
  const record = err as {
    statusCode?: unknown;
    message?: unknown;
    error?: unknown;
  };
  if (
    typeof record.statusCode === 'number' &&
    record.statusCode >= 400 &&
    record.statusCode < 600 &&
    typeof record.message === 'string'
  ) {
    return { statusCode: record.statusCode, message: record.message };
  }
  // RpcException payloads sometimes arrive nested on message or error.
  if (typeof record.message === 'object') {
    return authErrorBody(record.message, depth + 1);
  }
  if (typeof record.error === 'object') {
    return authErrorBody(record.error, depth + 1);
  }
  return undefined;
}
