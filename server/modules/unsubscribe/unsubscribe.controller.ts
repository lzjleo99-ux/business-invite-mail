/**
 * 退订端点（公开，无需登录）。
 *
 * - GET  /api/unsubscribe?token=xxx        → 用户从邮件链接点进来的确认页
 * - POST /api/unsubscribe/one-click        → RFC 8058 一键退订（Gmail/Outlook 用）
 * - GET  /api/unsubscribe/list             → 管理端列出抑制名单
 * - POST /api/unsubscribe/remove           → 管理端移除（用户重新订阅）
 */
import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '@server/modules/auth/jwt-auth.guard';
import { AdminGuard } from '@server/common/guards/admin.guard';
import { SuppressionService } from './suppression.service';
import { parseUnsubscribeToken } from './unsubscribe-token';

class RemoveDto {
  email!: string;
}

@Controller('openapi/unsubscribe')
export class UnsubscribeController {
  constructor(private readonly suppression: SuppressionService) {}

  private clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim().slice(0, 64);
    return (req.ip || '').slice(0, 64);
  }

  /** 用户点邮件里的退订链接 → 直接退订并显示确认页（无需二次点击） */
  @Get()
  async unsubscribeViaLink(
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const email = parseUnsubscribeToken(token || '');
    if (!email) {
      res.status(400).type('html').send(this.page('链接无效', '退订链接无效或已损坏。请从邮件原文中重新点击退订链接。'));
      return;
    }
    await this.suppression.suppress(email, 'user', this.clientIp(req));
    res.status(200).type('html').send(
      this.page(
        '已退订',
        `<strong>${this.escapeHtml(email)}</strong> 已加入退订名单。今后不会再收到我们的商业邮件。<br/><br/>如需重新接收，请联系我们。`,
      ),
    );
  }

  /**
   * RFC 8058 一键退订：邮件客户端发 POST，body = "List-Unsubscribe=One-Click"
   * 不能要求登录、不能重定向、不返回 JSON 以外的内容。
   */
  @Post('one-click')
  async oneClick(
    @Query('token') token: string,
    @Body('List-Unsubscribe') oneClick: string,
    @Req() req: Request,
  ): Promise<{ ok: boolean }> {
    if (oneClick !== 'One-Click') {
      throw new BadRequestException('Invalid one-click payload');
    }
    const email = parseUnsubscribeToken(token || '');
    if (!email) throw new BadRequestException('Invalid unsubscribe token');
    await this.suppression.suppress(email, 'user', this.clientIp(req), 'one-click');
    return { ok: true };
  }


  private escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c,
    );
  }

  private page(title: string, bodyHtml: string): string {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:12vh auto;padding:24px;color:#1e293b;line-height:1.7;background:#f8fafc}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
h1{font-size:20px;margin:0 0 12px;color:#0f172a}</style></head>
<body><div class="card"><h1>${title}</h1><p>${bodyHtml}</p></div></body></html>`;
  }
}


/** 管理端：退订名单管理（走 /api/ 需要登录+CSRF，正好安全） */
@Controller('api/unsubscribe')
export class UnsubscribeAdminController {
  constructor(private readonly suppression: SuppressionService) {}

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('list')
  async list(): Promise<{ items: Awaited<ReturnType<SuppressionService['list']>> }> {
    return { items: await this.suppression.list() };
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('remove')
  async remove(@Body() dto: RemoveDto): Promise<{ ok: boolean }> {
    if (!dto?.email) throw new BadRequestException('email required');
    return { ok: await this.suppression.remove(dto.email) };
  }
}
