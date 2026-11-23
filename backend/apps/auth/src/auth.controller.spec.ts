import { AuthResponse, AuthUser } from '@app/contracts';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  const user: AuthUser = {
    id: 'user-1',
    email: 'ada@school.edu',
    role: 'student',
  };
  const session: AuthResponse = { accessToken: 'token', user };
  const authService = {
    register: jest.fn().mockResolvedValue(session),
    login: jest.fn().mockResolvedValue(session),
    validate: jest.fn().mockResolvedValue(user),
  };
  const controller = new AuthController(authService as unknown as AuthService);

  it('forwards register, login, and validate to the service', async () => {
    const registerDto = { email: 'ada@school.edu', password: 'library-pass' };
    const loginDto = { email: 'ada@school.edu', password: 'library-pass' };

    await expect(controller.register(registerDto)).resolves.toBe(session);
    await expect(controller.login(loginDto)).resolves.toBe(session);
    await expect(controller.validate({ accessToken: 'token' })).resolves.toBe(
      user,
    );

    expect(authService.register).toHaveBeenCalledWith(registerDto);
    expect(authService.login).toHaveBeenCalledWith(loginDto);
    expect(authService.validate).toHaveBeenCalledWith('token');
  });
});
