import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AuthResponse,
  AuthUser,
  LoginDto,
  PATTERNS,
  RegisterDto,
  ValidateTokenDto,
} from '@app/contracts';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern(PATTERNS.AUTH.REGISTER)
  register(@Payload() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto);
  }

  @MessagePattern(PATTERNS.AUTH.LOGIN)
  login(@Payload() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto);
  }

  @MessagePattern(PATTERNS.AUTH.VALIDATE)
  validate(@Payload() dto: ValidateTokenDto): Promise<AuthUser> {
    return this.authService.validate(dto?.accessToken);
  }
}
