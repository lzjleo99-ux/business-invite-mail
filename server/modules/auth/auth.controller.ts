import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  ForbiddenException,
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

  /**
   * 公开注册默认关闭（账号由管理员在「用户管理」页创建）。
   * 需要开放时给服务加环境变量 ALLOW_SELF_REGISTRATION=true；
   * 首次部署（库里还没有任何账号）始终放行，否则永远建不出第一个管理员。
   */
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    const selfRegistrationEnabled =
      process.env.ALLOW_SELF_REGISTRATION === 'true';
    if (!selfRegistrationEnabled && (await this.authService.hasAnyUser())) {
      throw new ForbiddenException(
        '公开注册已关闭，请联系管理员创建账号',
      );
    }
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
