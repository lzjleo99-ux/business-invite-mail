import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
} from 'class-validator';
import type {
  AuthUser,
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  ChangePasswordRequest,
} from '@shared/api.interface';

class RegisterDto implements RegisterRequest {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsOptional()
  displayName!: string;
}

class LoginDto implements LoginRequest {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

class ChangePasswordDto implements ChangePasswordRequest {
  @IsString()
  oldPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(
      dto.email,
      dto.password,
      dto.displayName || dto.email.split('@')[0],
    );
  }

  @Post('login')
  async login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: { userId: string }): Promise<AuthUser> {
    return this.authService.me(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(): Promise<{ success: boolean }> {
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: { userId: string },
    @Body() dto: ChangePasswordDto,
  ): Promise<{ success: boolean }> {
    return this.authService.changePassword(
      user.userId,
      dto.oldPassword,
      dto.newPassword,
    );
  }
}
