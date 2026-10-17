import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  StreamableFile,
  Res,
  Inject,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AuthService } from '@server/modules/auth/auth.service';
import { MailService } from '@server/common/services/mail.service';
import { JwtAuthGuard } from '@server/modules/auth/jwt-auth.guard';
import { AdminGuard } from '@server/common/guards/admin.guard';
import { CurrentUser } from '@server/modules/auth/current-user.decorator';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import { materialBlobs as materialBlobsTable } from '@server/database/schema';
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
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
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

  // ============ 临时诊断（memcheck）：定位大文件下载把容器打死的问题，用完即删 ============
  @Get('memcheck')
  async memcheck(
    @Query('materialId') materialId: string,
    @Query('stream') streamMode: string,
    @Res({ passthrough: true }) res: import('express').Response,
  ): Promise<unknown> {
    const os = await import('os');
    const fsPromises = await import('fs/promises');
    const mem = (): Record<string, number> => {
      const m = process.memoryUsage();
      return { rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576), extMB: Math.round(m.external / 1048576) };
    };
    const readCgroup = async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      for (const [k, p] of [['limit', '/sys/fs/cgroup/memory.max'], ['current', '/sys/fs/cgroup/memory.current'], ['peak', '/sys/fs/cgroup/memory.peak']] as const) {
        try { out[k] = (await fsPromises.readFile(p, 'utf8')).trim(); } catch { out[k] = 'n/a'; }
      }
      return out;
    };

    const report: Record<string, unknown> = {
      base: mem(),
      cgroup: await readCgroup(),
      osTotalMB: Math.round(os.totalmem() / 1048576),
      osFreeMB: Math.round(os.freemem() / 1048576),
    };

    if (!materialId) return report;

    // 注入的 DRIZZLE_DATABASE 即 drizzle 实例
    const db = this.db as unknown as Record<string, unknown>;
    // 阶段1：drizzle select 整个 blob
    const t1 = Date.now();
    const rows = await this.db.select().from(materialBlobsTable).where(eq(materialBlobsTable.materialId, materialId)).limit(1);
    const row = rows[0] as { data?: Buffer; contentType?: string } | undefined;
    report.stage1_drizzleSelect = { ms: Date.now() - t1, found: !!row, byteLen: row?.data?.length, memAfter: mem() };
    if (!row) return report;

    // 阶段2：Buffer 复制（下载路径同款）
    const t2 = Date.now();
    const copy = Buffer.from(row.data);
    report.stage2_bufferCopy = { ms: Date.now() - t2, byteLen: copy.length, memAfter: mem() };

    // 阶段3：底层客户端直跑同样查询（raw unsafe，无 drizzle 层）
    const rawClient = (db['$client'] ?? (db['session'] as { client?: unknown } | undefined)?.client) as
      | { unsafe: (q: string, p?: unknown[]) => Promise<Array<{ data: Buffer }>> }
      | undefined;
    report.rawClientAvailable = !!rawClient;
    if (rawClient) {
      const t3 = Date.now();
      const rrows = await rawClient.unsafe('select data from material_blobs where material_id = $1', [materialId]);
      report.stage3_rawUnsafe = { ms: Date.now() - t3, byteLen: rrows[0]?.data?.length, memAfter: mem() };
    }

    if (streamMode === '1') {
      res.contentType(row.contentType || 'application/octet-stream');
      return new StreamableFile(copy);
    }
    return report;
  }
}
