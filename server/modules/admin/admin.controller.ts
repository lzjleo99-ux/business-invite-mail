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

  /**
   * 容器内 chromium 试验台：穷举 flag 组合（新/旧 headless、带/不带 virtual-time-budget、
   * data: URL 本地渲染），返回各组合的 stdout/stderr 长度，用于不在容器里也能定位可用配置。
   */
  private async netcheckChrome(url: string): Promise<Record<string, unknown>> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { access } = await import('fs/promises');
    const execFileAsync = promisify(execFile);
    const dirs = (process.env.PATH || '').split(':').filter(Boolean);
    let bin = '';
    for (const b of ['google-chrome', 'chromium', 'chromium-browser']) {
      for (const d of dirs) {
        try {
          await access(`${d}/${b}`);
          bin = `${d}/${b}`;
          break;
        } catch {
          // 换下一个目录/候选
        }
      }
      if (bin) break;
    }
    if (!bin) {
      return { error: 'no browser binary found' };
    }

    const base = [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-gpu',
    ];
    const variants: Record<string, string[]> = {
      'new+vtb': ['--headless=new', ...base, '--user-data-dir=/tmp/nc1', '--dump-dom', '--virtual-time-budget=5000'],
      'new-novtb': ['--headless=new', ...base, '--user-data-dir=/tmp/nc2', '--dump-dom'],
      'old+vtb': ['--headless=old', ...base, '--user-data-dir=/tmp/nc3', '--dump-dom', '--virtual-time-budget=5000'],
      'old-novtb': ['--headless=old', ...base, '--user-data-dir=/tmp/nc4', '--dump-dom'],
    };
    const out: Record<string, unknown> = { bin };
    for (const [name, flags] of Object.entries(variants)) {
      try {
        const { stdout, stderr } = await execFileAsync(bin, [...flags, url], {
          timeout: 20000,
          maxBuffer: 4 * 1024 * 1024,
        });
        out[name] = {
          stdoutLen: stdout.length,
          head: stdout.slice(0, 80),
          stderr: stderr.trim().slice(0, 160),
        };
      } catch (err: unknown) {
        out[name] = {
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        };
      }
    }
    // 文件输出类：--dump-dom 在新版 chromium 已不可用，改验证 screenshot / print-to-pdf
    const { stat } = await import('fs/promises');
    const fileVariants: Record<string, { flags: string[]; file: string }> = {
      'screenshot': {
        flags: ['--headless=new', ...base, '--user-data-dir=/tmp/nc6', '--hide-scrollbars', '--window-size=1280,900', '--screenshot=/tmp/nc-shot.png'],
        file: '/tmp/nc-shot.png',
      },
      'pdf': {
        flags: ['--headless=new', ...base, '--user-data-dir=/tmp/nc7', '--print-to-pdf=/tmp/nc-page.pdf'],
        file: '/tmp/nc-page.pdf',
      },
    };
    for (const [name, { flags, file }] of Object.entries(fileVariants)) {
      try {
        await execFileAsync(bin, [...flags, url], { timeout: 25000, maxBuffer: 1024 * 1024 });
        const st = await stat(file);
        out[name] = { fileBytes: st.size };
      } catch (err: unknown) {
        out[name] = { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
      }
    }
    return out;
  }

  /** 临时诊断：用与网站分析相同的 axios 实例抓取目标 URL，返回原始响应特征 */
  @Get('netcheck')
  async netcheck(
    @Query('url') url: string,
    @Query('mode') mode?: string,
  ): Promise<Record<string, unknown>> {
    if (mode === 'chrome') {
      return this.netcheckChrome(url);
    }
    if (!url) {
      return { error: 'missing url' };
    }
    const axios = (await import('axios')).default;
    const client = axios.create({
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        DNT: '1',
        'Upgrade-Insecure-Requests': '1',
      },
      validateStatus: (status: number) => status >= 200 && status < 400,
    });
    try {
      const r = await client.get<string>(url, { responseType: 'text' });
      const body = String(r.data ?? '');
      const stripped = body
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        ok: true,
        status: r.status,
        contentType: r.headers['content-type'] ?? null,
        contentEncoding: r.headers['content-encoding'] ?? null,
        rawLength: body.length,
        textLength: stripped.length,
        finalUrl: r.request?.res?.responseUrl ?? null,
        sample: body.slice(0, 300),
      };
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
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
