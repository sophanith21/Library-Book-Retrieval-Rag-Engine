import { AuthUser } from '@app/contracts';
import { AuthController } from '../src/auth.controller';
import { AuthService } from '../src/auth.service';

describe('Auth message handlers', () => {
  it('returns the user behind a validated token', async () => {
    const user: AuthUser = {
      id: 'user-1',
      email: 'ada@school.edu',
      role: 'student',
    };
    const authService = {
      validate: jest.fn().mockResolvedValue(user),
    } as unknown as AuthService;
    const controller = new AuthController(authService);

    await expect(
      controller.validate({ accessToken: 'token' }),
    ).resolves.toEqual(user);
  });
});
