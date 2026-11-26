import {
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, TimeoutError, timeout } from 'rxjs';

/**
 * Send an RPC to a microservice and translate its failure into an HTTP
 * error. Services throw RpcException({ statusCode, message }); anything else
 * (broker down, timeout) becomes 503/504.
 */
export async function rpc<T>(
  client: ClientProxy,
  pattern: string,
  payload: unknown,
  options: { service: string; timeoutMs?: number },
): Promise<T> {
  try {
    return await firstValueFrom(
      client
        .send<T>(pattern, payload)
        .pipe(timeout(options.timeoutMs ?? 10_000)),
    );
  } catch (err) {
    throw toHttpException(err, options.service);
  }
}

export function toHttpException(err: unknown, service: string): HttpException {
  if (err instanceof HttpException) return err;
  if (err instanceof TimeoutError) {
    return new HttpException(
      `${service} service timed out`,
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }
  const body = rpcErrorBody(err);
  if (body) {
    return new HttpException(
      { statusCode: body.statusCode, message: body.message },
      body.statusCode,
    );
  }
  return new ServiceUnavailableException(`${service} service unavailable`);
}

export function rpcErrorBody(
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
    return rpcErrorBody(record.message, depth + 1);
  }
  if (typeof record.error === 'object') {
    return rpcErrorBody(record.error, depth + 1);
  }
  return undefined;
}
