import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientProxy } from '@nestjs/microservices';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthUser, PATTERNS, SERVICES } from '@app/contracts';
import { rpc } from './rpc-client';

const ROLES_KEY = 'roles';

/**
 * Requires a valid bearer token (checked by the auth service, which also
 * confirms the user still exists). With roles given, the user must have one.
 * The validated user is available as request.user.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(SERVICES.AUTH) private readonly auth: ClientProxy,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthUser;
    }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Sign in to continue');
    }

    const user = await rpc<AuthUser>(
      this.auth,
      PATTERNS.AUTH.VALIDATE,
      { accessToken: token },
      { service: 'Auth' },
    );

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('You do not have access to this action');
    }
    request.user = user;
    return true;
  }
}

/** Signed-in users only. */
export const Authenticated = () =>
  applyDecorators(UseGuards(AuthGuard), ApiBearerAuth());

/** Admins only. */
export const AdminOnly = () =>
  applyDecorators(
    SetMetadata(ROLES_KEY, ['admin']),
    UseGuards(AuthGuard),
    ApiBearerAuth(),
  );
