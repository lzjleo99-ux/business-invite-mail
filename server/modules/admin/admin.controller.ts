import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AuthService } from '@server/modules/auth/auth.service';
import { MailService } from '@server/common/services/mail.service';
import { JwtAuthGuard } from '@server/modules/auth/jwt-auth.guard';
import { AdminGuard } from '@server/common/guards/admin.guard';
import { CurrentUser } from '@server/modules/auth/current-user.decorator';
import { IsString, IsBoolean, IsIn, IsOptional, MinLength, IsEmail } from 'class-validator';
import type {
  AdminUser,
  AdminUserListResponse,
  UpdateUserRoleRequest,
  UpdateUserActiveRequest,
} from '@shared/api.interface';

class UpdateUserRoleDto implements UpdateUserRoleRequest {
  @IsString()
  @IsIn(['admin', 'user'])
  role!: 'admin' | 'user';
}

class UpdateUserActiveDto implements UpdateUserActiveRequest {
  @IsBoolean()
  isActive!: boolean;
}

class SaveSmtpConfigDto {
  @IsString()
  host!: string;

  @IsOptional()
  @IsString()
  port?: string;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  fromName?: string;

  @IsString()
  fromEmail!: string;
}

class SendTestMailDto {
  @IsEmail()
  to!: string;
}

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  displayName!: string;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly authService: AuthService,
    private readonly mailService: MailService,
  ) {}

  /** 读取 SMTP 配置（密码只返回是否已设置） */
  @Get('smtp-config')
  async getSmtpConfig(): Promise<{
    configured: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    username?: string | null;
    passwordSet?: boolean;
    fromName?: string | null;
    fromEmail?: string;
  }> {
    const s = await this.mailService.getSettings();
    if (!s) {
      return { configured: false };
    }
    return {
      configured: true,
      host: s.host,
      port: s.port,
      secure: s.secure,
      username: s.username,
      passwordSet: !!s.password,
      fromName: s.fromName,
      fromEmail: s.fromEmail,
    };
  }

  @Post('smtp-config')
  async saveSmtpConfig(@Body() dto: SaveSmtpConfigDto): Promise<{ success: boolean }> {
    await this.mailService.saveSettings({
      host: dto.host,
      port: dto.port ? parseInt(dto.port, 10) : 465,
      secure: dto.secure !== false,
      username: dto.username,
      password: dto.password,
      fromName: dto.fromName,
      fromEmail: dto.fromEmail,
    });
    return { success: true };
  }

  @Post('smtp-test')
  async testSmtp(@Body() dto: SendTestMailDto): Promise<{ success: boolean }> {
    await this.mailService.sendTestMail(dto.to);
    return { success: true };
  }

  /** 管理员创建账号（公开注册已关闭，账号统一由这里发放） */
  @Post('users')
  async createUser(@Body() dto: CreateUserDto): Promise<{
    id: string;
    email: string;
    displayName: string;
    role: 'admin' | 'user';
    isActive: boolean;
  }> {
    const { user } = await this.authService.createUserByAdmin(
      dto.email,
      dto.password,
      dto.displayName,
    );
    return user;
  }

  @Get('users')
  async listUsers(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('search') search?: string,
  ): Promise<AdminUserListResponse> {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 10;
    return this.adminService.listUsers(pageNum, pageSizeNum, search);
  }

  @Patch('users/:id/role')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() user: { userId: string },
  ): Promise<AdminUser> {
    return this.adminService.updateRole(id, user.userId, dto.role);
  }

  @Patch('users/:id/active')
  async updateActive(
    @Param('id') id: string,
    @Body() dto: UpdateUserActiveDto,
    @CurrentUser() user: { userId: string },
  ): Promise<AdminUser> {
    return this.adminService.updateActive(id, user.userId, dto.isActive);
  }
}
