import { RpcException } from '@nestjs/microservices';
import { verify } from 'jsonwebtoken';
import { PrismaService } from '@app/prisma';
import { AuthService } from './auth.service';

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.BCRYPT_ROUNDS = '4';

type StoredUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
};

function authMessage(err: unknown): { statusCode: number; message: string } {
  expect(err).toBeInstanceOf(RpcException);
  return (err as RpcException).getError() as {
    statusCode: number;
    message: string;
  };
}

describe('AuthService', () => {
  const users: StoredUser[] = [];
  const prisma = {
    user: {
      findUnique: jest.fn(
        ({ where }: { where: { email?: string; id?: string } }) => {
          if (where.email) {
            return users.find((user) => user.email === where.email) ?? null;
          }
          if (where.id) {
            return users.find((user) => user.id === where.id) ?? null;
          }
          return null;
        },
      ),
      create: jest.fn(({ data }: { data: Omit<StoredUser, 'id'> }) => {
        if (users.some((user) => user.email === data.email)) {
          const err = new Error('Unique constraint failed');
          (err as Error & { code: string }).code = 'P2002';
          throw err;
        }
        const user = { id: `user-${users.length + 1}`, ...data };
        users.push(user);
        return user;
      }),
    },
  };
  const service = new AuthService(prisma as unknown as PrismaService);

  beforeEach(() => {
    users.length = 0;
  });

  it('registers a student and returns a token for that user', async () => {
    const result = await service.register({
      email: 'Ada@School.edu',
      password: 'library-pass',
    });

    expect(result.user).toEqual({
      id: 'user-1',
      email: 'ada@school.edu',
      role: 'student',
    });
    expect(users[0].passwordHash).not.toContain('library-pass');
    const payload = verify(result.accessToken, 'test-secret');
    expect(payload).toMatchObject({
      sub: 'user-1',
      email: 'ada@school.edu',
      role: 'student',
    });
  });

  it('rejects a short password, a bad email, and an unknown role', async () => {
    await expect(
      service.register({ email: 'ada@school.edu', password: 'short' }),
    ).rejects.toBeInstanceOf(RpcException);
    await expect(
      service.register({ email: 'not-an-email', password: 'library-pass' }),
    ).rejects.toMatchObject({});
    try {
      await service.register({
        email: 'ada@school.edu',
        password: 'library-pass',
        role: 'librarian' as 'student',
      });
      throw new Error('expected role rejection');
    } catch (err) {
      expect(authMessage(err)).toEqual({
        statusCode: 400,
        message: 'role must be student or admin',
      });
    }
    expect(users).toHaveLength(0);
  });

  it('rejects a duplicate email', async () => {
    await service.register({
      email: 'ada@school.edu',
      password: 'library-pass',
    });
    await expect(
      service.register({
        email: 'ada@school.edu',
        password: 'another-pass',
      }),
    ).rejects.toMatchObject({});
    try {
      await service.register({
        email: 'Ada@School.edu',
        password: 'another-pass',
      });
    } catch (err) {
      expect(authMessage(err).statusCode).toBe(409);
    }
  });

  it('logs in with the registered password and rejects the wrong one', async () => {
    await service.register({
      email: 'ada@school.edu',
      password: 'library-pass',
      role: 'admin',
    });

    const session = await service.login({
      email: 'ADA@school.edu',
      password: 'library-pass',
    });
    expect(session.user.role).toBe('admin');

    await expect(
      service.login({ email: 'ada@school.edu', password: 'wrong-pass' }),
    ).rejects.toBeInstanceOf(RpcException);
    await expect(
      service.login({ email: 'missing@school.edu', password: 'library-pass' }),
    ).rejects.toBeInstanceOf(RpcException);
  });

  it('validates a live token and rejects a missing user or a bad token', async () => {
    const session = await service.register({
      email: 'ada@school.edu',
      password: 'library-pass',
    });
    await expect(service.validate(session.accessToken)).resolves.toEqual(
      session.user,
    );

    users.length = 0;
    await expect(service.validate(session.accessToken)).rejects.toBeInstanceOf(
      RpcException,
    );
    await expect(service.validate('not-a-jwt')).rejects.toBeInstanceOf(
      RpcException,
    );
    await expect(service.validate(undefined)).rejects.toBeInstanceOf(
      RpcException,
    );
  });
});
