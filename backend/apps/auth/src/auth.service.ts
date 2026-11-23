import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { compare, hash, hashSync } from 'bcrypt';
import {
  JsonWebTokenError,
  sign,
  TokenExpiredError,
  verify,
  type JwtPayload,
  type SignOptions,
} from 'jsonwebtoken';
import { AuthResponse, AuthUser, LoginDto, RegisterDto } from '@app/contracts';
import { PrismaService } from '@app/prisma';

const ROLES = new Set(['student', 'admin']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let unknownUserHash: string | undefined;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const email = normalizeEmail(dto?.email);
    const password = dto?.password ?? '';
    assertEmail(email);
    assertPassword(password);
    const role = resolveRole(dto?.role);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: await hash(password, saltRounds()),
          role,
        },
      });
      return toAuthResponse(user);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw authError(409, 'Email already registered');
      }
      throw err;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const email = normalizeEmail(dto?.email);
    const password = dto?.password ?? '';
    const user = email
      ? await this.prisma.user.findUnique({ where: { email } })
      : null;

    // Compare against a real hash when the email is unknown so the response
    // time does not reveal which emails are registered.
    const matches = await compare(
      password,
      user?.passwordHash ?? placeholderHash(),
    );
    if (!user || !matches) {
      throw authError(401, 'Invalid email or password');
    }
    return toAuthResponse(user);
  }

  async validate(accessToken: string | undefined): Promise<AuthUser> {
    const payload = readToken(accessToken);
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw authError(401, 'Invalid or expired token');
    }
    return toAuthUser(user);
  }
}

function toAuthResponse(user: {
  id: string;
  email: string;
  role: string;
}): AuthResponse {
  return {
    accessToken: signToken(user),
    user: toAuthUser(user),
  };
}

function toAuthUser(user: {
  id: string;
  email: string;
  role: string;
}): AuthUser {
  return { id: user.id, email: user.email, role: user.role };
}

function signToken(user: { id: string; email: string; role: string }): string {
  const options: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as SignOptions['expiresIn'],
    subject: user.id,
  };
  return sign({ email: user.email, role: user.role }, jwtSecret(), options);
}

function readToken(
  accessToken: string | undefined,
): JwtPayload & { sub: string } {
  if (!accessToken) {
    throw authError(401, 'Invalid or expired token');
  }
  try {
    const payload = verify(accessToken, jwtSecret());
    if (typeof payload === 'string' || !payload.sub) {
      throw authError(401, 'Invalid or expired token');
    }
    return payload as JwtPayload & { sub: string };
  } catch (err) {
    if (err instanceof RpcException) throw err;
    if (err instanceof TokenExpiredError || err instanceof JsonWebTokenError) {
      throw authError(401, 'Invalid or expired token');
    }
    throw err;
  }
}

function saltRounds(): number {
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);
  return Number.isInteger(rounds) && rounds > 0 ? rounds : 10;
}

function placeholderHash(): string {
  unknownUserHash ??= hashSync('not-a-registered-user', saltRounds());
  return unknownUserHash;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw authError(500, 'JWT_SECRET is not configured');
  }
  return secret;
}

function normalizeEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? '';
}

function assertEmail(email: string): void {
  if (!EMAIL_PATTERN.test(email)) {
    throw authError(400, 'A valid email is required');
  }
}

function assertPassword(password: string): void {
  if (password.length < 8) {
    throw authError(400, 'Password must be at least 8 characters');
  }
}

function resolveRole(role: string | undefined): string {
  if (role === undefined || role === '') return 'student';
  if (!ROLES.has(role)) {
    throw authError(400, 'role must be student or admin');
  }
  return role;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'P2002'
  );
}

function authError(statusCode: number, message: string): RpcException {
  return new RpcException({ statusCode, message });
}
