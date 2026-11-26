import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { AuthGuard } from './auth.guard';

function context(authorization?: string) {
  const request: {
    headers: Record<string, string | undefined>;
    user?: unknown;
  } = {
    headers: { authorization },
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function guard(role: string | Error, requiredRoles?: string[]) {
  const auth = {
    send: jest.fn(() =>
      role instanceof Error
        ? throwError(() => ({ statusCode: 401, message: role.message }))
        : of({ id: 'u1', email: 'a@b.c', role }),
    ),
  };
  const reflector = {
    getAllAndOverride: () => requiredRoles,
  } as unknown as Reflector;
  return { guard: new AuthGuard(auth as never, reflector), auth };
}

describe('AuthGuard', () => {
  it('rejects requests without a bearer token', async () => {
    const { guard: g, auth } = guard('student');
    await expect(g.canActivate(context().ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      g.canActivate(context('Basic abc').ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.send).not.toHaveBeenCalled();
  });

  it('passes the auth service error through', async () => {
    const { guard: g } = guard(new Error('Invalid or expired token'));
    await expect(g.canActivate(context('Bearer t').ctx)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('attaches the user when no role is required', async () => {
    const { guard: g } = guard('student');
    const { ctx, request } = context('Bearer t');
    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toMatchObject({ role: 'student' });
  });

  it('enforces required roles', async () => {
    await expect(
      guard('student', ['admin']).guard.canActivate(context('Bearer t').ctx),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard('admin', ['admin']).guard.canActivate(context('Bearer t').ctx),
    ).resolves.toBe(true);
  });
});
