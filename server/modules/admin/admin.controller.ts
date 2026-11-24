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
  Inject,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import { modelConfig } from '@server/database/schema';
import { AdminService } from './admin.service';
import { AuthService } from '@server/modules/auth/auth.service';
import { MailService } from '@server/common/services/mail.service';
import { EmailInboxService } from '@server/modules/email-generator/email-inbox.service';
import { WeComNotifyService } from '@server/modules/email-generator/wecom-notify.service';
import axios from 'axios';
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
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 企业微信群机器人通知配置（webhook 只写不读，只回 webhookSet） */
  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  /** 临时诊断：强制重跑租户自愈迁移并返回统计（super_admin 专用） */
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('tenant-bootstrap')
  async tenantBootstrap(): Promise<{
    owner: string; roleChanges: string[]; transferred: number; backfilled: number;
  }> {
    return this.authService.runTenantBootstrap(true);
  }

  @Get('wecom-notify-config')
  async getWecomNotifyConfig(@CurrentUser() user: JwtPayload): Promise<{
    enabled: boolean;
    autoStarOnReply: boolean;
    includeSnippet: boolean;
    webhookSet: boolean;
  }> {
    const cfg = await this.wecomNotifyService.getConfig(user.userId, user.displayName);
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
  async listSmtpAccounts(@CurrentUser() user: JwtPayload): Promise<{ items: Awaited<ReturnType<MailService['listAccounts']>> }> {
    // super_admin 看全部账号（发信邮箱是团队资源，管理员代发）；
    // 普通用户看自己的 + 全局账号。发送端会再做一次归属校验。
    return {
      items: await this.mailService.listAccounts(user.userId, {
        includeAll: user.role === 'super_admin',
      }),
    };
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
      imapHost?: string | null;
      imapPort?: number;
      imapSecure?: boolean;
      inboxPollEnabled?: boolean;
      inboxPollSeconds?: number;
    },
    @CurrentUser() user: JwtPayload,
  ): Promise<{ id: string }> {
    if (!body?.email || !body?.password || !body?.host) {
      throw new BadRequestException('邮箱、授权码/密码、SMTP 服务器都不能为空');
    }
    return this.mailService.addAccount({ ...body, ownerId: user.userId });
  }

  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Patch('smtp-accounts/:id')
  async updateSmtpAccount(
    @Param('id') id: string,
    @Body()
    body: {
      email?: string;
      password?: string;
      host?: string;
      port?: number;
      secure?: boolean;
      fromName?: string | null;
      imapHost?: string | null;
      imapPort?: number;
      imapSecure?: boolean;
      inboxPollEnabled?: boolean;
      inboxPollSeconds?: number;
    },
    @CurrentUser() user: JwtPayload,
  ): Promise<{ ok: true }> {
    await this.mailService.updateAccount(id, body, user.userId);
    return { ok: true };
  }

  @Delete('smtp-accounts/:id')
  async deleteSmtpAccount(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ ok: true }> {
    await this.mailService.deleteAccount(id, user.userId);
    return { ok: true };
  }

  // 每用户独立的设置：只需登录，不需要管理员
  @UseGuards(JwtAuthGuard)
  @Post('smtp-accounts/:id/default')
  async setDefaultSmtpAccount(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ ok: true }> {
    await this.mailService.setDefaultAccount(id, user.userId);
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
      uiLanguage?: string;
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

  /** 验证指定发信账号能否登录（只 SMTP verify，不真发邮件） */
  @UseGuards(JwtAuthGuard)
  @Post('smtp-accounts/:id/verify')
  async verifySmtpAccount(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ ok: boolean; message: string }> {
    return this.mailService.verifySmtpAccount(id, user.userId);
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

  /** 网络连通性诊断（super_admin）：从容器内测指定 URL，定位"Network Error"类问题 */
  /** 批量任务诊断（super_admin）：查持久化进度表 + 项目状态分布 */
  @Get('batch-diagnose')
  async batchDiagnose(
    @CurrentUser() user: JwtPayload,
    @Query('projectId') projectId?: string,
  ): Promise<Record<string, unknown>> {
    const batches = await this.db.execute(sql`
      SELECT batch_key, kind, user_id, project_id, total, done, failed,
             jsonb_array_length(processed_ids) AS processed,
             jsonb_array_length(targets) AS targets,
             active_ids, started_at, updated_at, finished_at
      FROM server_batches
      ORDER BY started_at DESC LIMIT 10
    `);
    // 最近失败样本：generate_error 里写着每次失败的原因（浪费 token 的根因）
    const errors = await this.db.execute(sql`
      SELECT left(generate_error, 220) AS err, count(*)::int AS count,
             min(_updated_at) AS first_at, max(_updated_at) AS last_at
      FROM restaurants
      WHERE project_id = ${projectId} AND generate_error IS NOT NULL AND generate_error <> ''
      GROUP BY left(generate_error, 220)
      ORDER BY count DESC LIMIT 8
    `);
    // 各用户模型配置（诊断"用了谁的模型"）：base_url + 模型名 + key 指纹（不外泄密钥）
    // SMTP 账号配置摘要（不含密码）——诊断"设置正常但发信失败"
    const projRows = await this.db.execute(sql`
      SELECT id, (owner_id)::text AS owner_id, name FROM projects WHERE id = ${projectId} LIMIT 1
    `);
    const projectOwner = projRows[0] ?? null;
    const smtpRows = await this.db.execute(sql`
      SELECT id, (owner_id)::text AS owner_id, email, host, port, secure, from_name, is_default,
             length(password) AS password_len, imap_host, imap_port
      FROM smtp_accounts ORDER BY email
    `);
    const smtpSummary = smtpRows;
    const cfgRows = await this.db
      .select({
        createdBy: modelConfig.createdBy,
        apiBaseUrl: modelConfig.apiBaseUrl,
        modelName: modelConfig.modelName,
        apiKey: modelConfig.apiKey,
      })
      .from(modelConfig);
    const modelRows = cfgRows.map((r: { createdBy: unknown; apiBaseUrl: string | null; modelName: string | null; apiKey: string | null }) => ({
      user_id: r.createdBy ? String(JSON.stringify(r.createdBy)) : null,
      api_base_url: r.apiBaseUrl,
      model_name: r.modelName,
      key_head: (r.apiKey || '').slice(0, 6),
      key_len: (r.apiKey || '').length,
    }));
    let statusCounts: unknown = null;
    if (projectId) {
      const rows = await this.db.execute(sql`
        SELECT status, count(*)::int AS count
        FROM restaurants WHERE project_id = ${projectId} GROUP BY status
      `);
      statusCounts = rows;
    }
    return { batches, errors, modelRows, smtpSummary, projectOwner, statusCounts, note: 'server_batches 持久化进度 + 项目状态分布' };
  }

  @Get('netcheck')
  async netcheck(
    @CurrentUser() user: JwtPayload,
    @Query('url') url: string | undefined,
  ): Promise<Record<string, unknown>> {
    const target = (url || '').trim();
    if (!target || !/^https?:\/\//i.test(target)) {
      throw new BadRequestException('url 必须以 http(s):// 开头');
    }
    const started = Date.now();
    try {
      const r2 = await axios.get(target, {
        headers: { Authorization: 'Bearer probe', Accept: 'application/json' },
        timeout: 8000,
        validateStatus: () => true,
      });
      return {
        url: target,
        reachable: true,
        httpStatus: r2.status,
        ms: Date.now() - started,
        note: 'HTTP 状态已返回 = 网络可达（401/403 = 可达但鉴权失败，属正常探测）',
      };
    } catch (err: unknown) {
      const isAx = (err as { isAxiosError?: boolean })?.isAxiosError === true;
      const code = (err as { code?: string })?.code;
      const message = err instanceof Error ? err.message : String(err);
      return {
        url: target,
        reachable: false,
        ms: Date.now() - started,
        error: message,
        code: isAx ? code : undefined,
        hint:
          code === 'ECONNABORTED' || (Date.now() - started) > 7500
            ? '连接超时：容器到该地址的网络不通（可能是跨境/防火墙）'
            : code === 'ECONNREFUSED'
              ? '连接被拒绝：目标端口未开放'
              : code === 'ENOTFOUND'
                ? '域名解析失败'
                : message.toLowerCase().includes('network')
                  ? '网络层失败：容器无法建立到该地址的连接（跨境访问中国 IP 常见）'
                  : undefined,
      };
    }
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
