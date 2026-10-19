import type { UserRole } from '@shared/api.interface';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AuthService } from '@server/modules/auth/auth.service';
import { MailService } from '@server/common/services/mail.service';
import { EmailInboxService } from '@server/modules/email-generator/email-inbox.service';
import { WeComNotifyService } from '@server/modules/email-generator/wecom-notify.service';
import { JwtAuthGuard, type JwtPayload } from '@server/modules/auth/jwt-auth.guard';
import { AdminGuard } from '@server/common/guards/admin.guard';
import { SuperAdminGuard } from '@server/common/guards/super-admin.guard';
import { CurrentUser } from '@server/modules/auth/current-user.decorator';
import { IsString, IsBoolean, IsIn, IsOptional, IsNumber, MinLength, IsEmail } from 'class-validator';
import { Type } from 'class-transformer';
import type {
  AdminUser,
  AdminUserListResponse,
  UpdateUserRoleRequest,
  UpdateUserActiveRequest,
} from '@shared/api.interface';

class UpdateUserRoleDto implements UpdateUserRoleRequest {
  @IsString()
  // super_admin 不在这里发放：只能由现有超级管理员在专用接口授予，且全系统唯一
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

  // ---- IMAP 收信 ----
  @IsOptional()
  @IsString()
  imapHost?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  imapPort?: number;

  @IsOptional()
  @IsBoolean()
  imapSecure?: boolean;

  @IsOptional()
  @IsBoolean()
  inboxPollEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  inboxPollSeconds?: number;
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
    private readonly emailInboxService: EmailInboxService,
    private readonly wecomNotifyService: WeComNotifyService,
  ) {}

  /** 企业微信群机器人通知配置（webhook 只写不读，只回 webhookSet） */
  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Get('wecom-notify-config')
  async getWecomNotifyConfig(@CurrentUser() user: JwtPayload): Promise<{
    enabled: boolean;
    autoStarOnReply: boolean;
    includeSnippet: boolean;
    webhookSet: boolean;
  }> {
    const cfg = await this.wecomNotifyService.getConfig();
    return {
      enabled: cfg.enabled,
      autoStarOnReply: cfg.autoStarOnReply,
      includeSnippet: cfg.includeSnippet,
      webhookSet: cfg.webhookSet,
    };
  }

  // ==================== 多个发信账号（邮箱后台） ====================

  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Get('smtp-accounts')
  async listSmtpAccounts(): Promise<{ items: Awaited<ReturnType<MailService['listAccounts']>> }> {
    return { items: await this.mailService.listAccounts() };
  }

  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Post('smtp-accounts')
  async addSmtpAccount(
    @Body()
    body: {
      email: string;
      password: string;
      host: string;
      port: number;
      secure: boolean;
      fromName?: string;
    },
  ): Promise<{ id: string }> {
    if (!body?.email || !body?.password || !body?.host) {
      throw new BadRequestException('邮箱、授权码/密码、SMTP 服务器都不能为空');
    }
    return this.mailService.addAccount(body);
  }

  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Delete('smtp-accounts/:id')
  async deleteSmtpAccount(@Param('id') id: string): Promise<{ ok: true }> {
    await this.mailService.deleteAccount(id);
    return { ok: true };
  }

  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Post('smtp-accounts/:id/default')
  async setDefaultSmtpAccount(@Param('id') id: string): Promise<{ ok: true }> {
    await this.mailService.setDefaultAccount(id);
    return { ok: true };
  }

  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Post('wecom-notify-config')
  async saveWecomNotifyConfig(
    @Body() dto: {
      webhookUrl?: string;
      enabled?: boolean;
      autoStarOnReply?: boolean;
      includeSnippet?: boolean;
    },
    @CurrentUser() user: JwtPayload,
  ): Promise<{ success: boolean }> {
    await this.wecomNotifyService.saveConfig(dto, user.userId);
    return { success: true };
  }

  /** 测试企微推送（会真实发一条消息到群里） */
  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Post('wecom-notify-test')
  async testWecomNotify(
    @Body() body: { webhookUrl?: string },
  ): Promise<{ ok: boolean; message: string }> {
    return this.wecomNotifyService.test(body?.webhookUrl);
  }

  /** 读取 SMTP 配置（密码只返回是否已设置） */
  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Get('smtp-config')
  async getSmtpConfig(@CurrentUser() user: JwtPayload): Promise<{
    configured: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    username?: string | null;
    passwordSet?: boolean;
    fromName?: string | null;
    fromEmail?: string;
    imapHost?: string | null;
    imapPort?: number;
    imapSecure?: boolean;
    inboxPollEnabled?: boolean;
    inboxPollSeconds?: number;
  }> {
    // 每用户独立：读自己的 SMTP（没有则回退旧的全局行）
    const s = await this.mailService.getSettings(user.userId);
    if (!s) {
      return { configured: false };
    }
    const imap = await this.mailService.getImapSettings(user.userId);
    return {
      configured: true,
      host: s.host,
      port: s.port,
      secure: s.secure,
      username: s.username,
      passwordSet: !!s.password,
      fromName: s.fromName,
      fromEmail: s.fromEmail,
      imapHost: imap.imapHost,
      imapPort: imap.imapPort,
      imapSecure: imap.imapSecure,
      inboxPollEnabled: imap.inboxPollEnabled,
      inboxPollSeconds: imap.inboxPollSeconds,
    };
  }

  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Post('smtp-config')
  async saveSmtpConfig(
    @Body() dto: SaveSmtpConfigDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ success: boolean }> {
    // 每用户独立：写自己的那一行，不再覆盖别人的配置
    await this.mailService.saveSettings({
      host: dto.host,
      port: dto.port ? parseInt(dto.port, 10) : 465,
      secure: dto.secure !== false,
      username: dto.username,
      password: dto.password,
      fromName: dto.fromName,
      fromEmail: dto.fromEmail,
      userId: user.userId,
    });
    // IMAP 收信配置走自建表（smtp_config 是平台表，不能加列）
    await this.mailService.saveInboxSettings({
      imapHost: dto.imapHost,
      imapPort: dto.imapPort,
      imapSecure: dto.imapSecure,
      inboxPollEnabled: dto.inboxPollEnabled,
      inboxPollSeconds: dto.inboxPollSeconds,
    }, user.userId);
    // 收信轮询开关/间隔热更新（保存即生效，不用重启服务）
    await this.emailInboxService.refreshSchedule();
    return { success: true };
  }

  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
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
    role: UserRole;
    isActive: boolean;
  }> {
    const { user } = await this.authService.createUserByAdmin(
      dto.email,
      dto.password,
      dto.displayName,
    );
    return user;
  }

  /**
   * 授予/收回超级管理员（全系统唯一）。
   * 只能由现有超级管理员调用；授予前会先把现任降级，保证同时只有一个。
   */
  @Post('super-admin/:userId')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async setSuperAdmin(
    @Param('userId') userId: string,
    @CurrentUser() current: JwtPayload,
  ): Promise<{ ok: true }> {
    if (!userId) throw new BadRequestException('userId 不能为空');
    if (userId === current.userId) {
      throw new BadRequestException('不能对自己执行此操作');
    }
    await this.adminService.setSuperAdmin(userId);
    return { ok: true };
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
