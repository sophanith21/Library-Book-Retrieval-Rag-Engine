import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export const CurrentToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();

    const authorization = request.headers.authorization;

    if (!authorization) return undefined;

    const [scheme, token] = authorization.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return undefined;
    }

    return token;
  },
);
