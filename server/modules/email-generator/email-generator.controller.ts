import type { UserRole } from '@shared/api.interface';
import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  BadRequestException,
  NotFoundException,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { EmailGeneratorService, type BatchSendSummary } from './email-generator.service';
import { EmailHistoryService, type EmailHistoryRow, type EmailHistoryDetail } from './email-history.service';
import { EmailInboxService, type InboxPollResult } from './email-inbox.service';
import type {
  GeneratedEmail,
  BatchGenerateRequest,
  EmlDownloadResponse,
  WhatsAppInfo,
  BatchWhatsAppRequest,
} from '@shared/api.interface';

class EmailHistoryQueryDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsIn(['outbound', 'inbound'])
  direction?: 'outbound' | 'inbound';

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  pageSize?: number;
}

class BatchGenerateDto implements BatchGenerateRequest {
  @IsOptional()
  @IsArray()
  @Type(() => String)
  companyIds?: string[];

  @IsOptional()
  @IsString()
  projectId?: string;
}

class BatchWhatsAppDto implements BatchWhatsAppRequest {
  @IsString()
  projectId!: string;
}

class BatchSendDto {
  /** 只发这些公司；为空/不传 = 整个项目 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  companyIds?: string[];

  /** 用哪个发信账号（多邮箱后缀）；不传走默认 */
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsString()
  projectId!: string;
  /** 默认发送语言版本：local=收件人本地语言，en=英文 */
  @IsOptional()
  @IsIn(['local', 'en'])
  lang?: 'local' | 'en';
  /**
   * 逐公司语言覆盖 {companyId: 'local'|'en'}，来自用户在该行「邮件内容」里的语言切换。
   * 目的：保证「预览看到哪一版 == 实际发出哪一版」——批量发送必须尊重每行的预览选择，
   * 而不是全项目一刀切。没出现在这里的公司用上面的 lang 兜底。
   */
  @IsOptional()
  @IsObject()
  langOverrides?: Record<string, 'local' | 'en'>;
}

class ComposeSaveDto {
  @IsString()
  subject!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsString()
  subjectLocal?: string;

  @IsOptional()
  @IsString()
  bodyLocal?: string;

  @IsString()
  language!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('api/email-generator')
export class EmailGeneratorController {
  constructor(
    private readonly emailGeneratorService: EmailGeneratorService,
    private readonly emailHistoryService: EmailHistoryService,
    private readonly emailInboxService: EmailInboxService,
  ) {}

  @Post('generate/:companyId')
  async generate(
    @CurrentUser() user: JwtPayload,
    @Param('companyId') companyId: string,
  ): Promise<GeneratedEmail> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    return this.emailGeneratorService.generateEmail(companyId, user.userId);
  }

  @Post('batch-generate')
  async batchGenerate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BatchGenerateDto,
  ): Promise<{ total: number }> {
    return this.emailGeneratorService.batchGenerate(
      dto.companyIds,
      dto.projectId,
      user.userId,
    );
  }

  @Get('eml/:companyId')
  async getEml(
    @Param('companyId') companyId: string,
    @Res() res: Response,
  ): Promise<void> {
    const result: EmlDownloadResponse = await this.emailGeneratorService.getEml(companyId);
    // 带 CID 内嵌图时 emlContent 可达数 MB（base64）——必须 @Res() 接管直接写出，
    // 返回 void。平台 LoggingInterceptor 会对 handler 返回值无条件 JSON.stringify
    // （见 projects.controller downloadMaterial 的注释），返回大字符串会白白放大进日志。
    res.setHeader('Content-Type', 'message/rfc822; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`,
    );
    res.send(result.emlContent);
  }

  @Get('whatsapp/:companyId')
  async getWhatsApp(
    @Param('companyId') companyId: string,
  ): Promise<WhatsAppInfo> {
    return this.emailGeneratorService.getWhatsAppInfo(companyId);
  }

  @Post('whatsapp/:companyId')
  async generateWhatsApp(
    @CurrentUser() user: JwtPayload,
    @Param('companyId') companyId: string,
  ): Promise<WhatsAppInfo> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    return this.emailGeneratorService.generateWhatsAppForCompany(companyId, user.userId);
  }

  @Post('batch-whatsapp')
  async batchWhatsApp(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BatchWhatsAppDto,
  ): Promise<{ total: number }> {
    return this.emailGeneratorService.batchPrepareWhatsApp(dto.projectId, user.userId);
  }

  /**
   * 单公司直发：把已生成的邮件经 SMTP 发给该公司（自动收件人/主题/内嵌图），
   * 成功后自动标记「已邮件联系」。
   */
  @Post('send/:companyId')
  async sendEmail(
    @Param('companyId') companyId: string,
    @Query('lang') lang: string | undefined,
    @Query('accountId') accountId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ to: string; subject: string }> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    return this.emailGeneratorService.sendCompanyEmail(
      companyId,
      lang === 'en' ? 'en' : 'local',
      accountId,
      user.userId,
    );
  }

  /**
   * 一键发送：项目内所有「已生成 + 有邮箱 + 未发送」的公司逐家经 SMTP 发出。
   * 耗时与公司数成正比（每封 1-2s），客户端超时给足。
   */
  @Post('batch-send')
  async batchSend(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BatchSendDto,
  ): Promise<BatchSendSummary> {
    if (!dto.projectId) {
      throw new BadRequestException('projectId 不能为空');
    }
    return this.emailGeneratorService.batchSendProjectEmails(
      dto.projectId,
      {
        userId: user.userId,
        role: user.role,
      },
      dto.lang ?? 'local',
      dto.langOverrides,
      { companyIds: dto.companyIds, accountId: dto.accountId },
    );
  }

  /**
   * 邮件往来历史查询：带 companyId 查单公司（公司行展开面板），
   * 带 projectId/direction/status/search/page 查全局（往来历史页）。
   */
  @Get('histories')
  async histories(
    @Query() query: EmailHistoryQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ items: EmailHistoryRow[]; total: number }> {
    return this.emailHistoryService.list({
      companyId: query.companyId,
      projectId: query.projectId,
      direction: query.direction,
      status: query.status,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
      user: { userId: user.userId, role: user.role },
    });
  }

  /** 单条往来详情（点开看完整正文；列表只返回 140 字摘要） */
  @Get('histories/detail/:id')
  async historyDetail(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<EmailHistoryDetail> {
    const detail = await this.emailHistoryService.getDetail(id, {
      userId: user.userId,
      role: user.role,
    });
    if (!detail) {
      throw new NotFoundException('该往来记录不存在');
    }
    return detail;
  }

  /** 单公司往来（公司行下拉/展开面板用，最近 50 条） */
  @Get('histories/:companyId')
  async companyHistories(
    @Param('companyId') companyId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ items: EmailHistoryRow[] }> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    return {
      items: await this.emailHistoryService.listByCompany(companyId, {
        userId: user.userId,
        role: user.role,
      }),
    };
  }

  /** 手动收取一次收件箱（设置页「立即收取」按钮；后台轮询与此同路径） */
  @Post('inbox-poll')
  async inboxPoll(): Promise<InboxPollResult> {
    return this.emailInboxService.poll();
  }

  @Get('compose/:companyId')
  async getCompose(
    @Param('companyId') companyId: string,
  ): Promise<{
    recipientEmail: string | null;
    subject: string;
    body: string;
    subjectLocal: string | null;
    bodyLocal: string | null;
    languageCode: string | null;
    companyName: string;
  }> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    return this.emailGeneratorService.getCompose(companyId);
  }

  @Patch('compose/:companyId')
  async saveCompose(
    @Param('companyId') companyId: string,
    @Body() dto: ComposeSaveDto,
  ): Promise<{ success: boolean }> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    await this.emailGeneratorService.saveCompose(companyId, {
      subject: dto.subject,
      body: dto.body,
      subjectLocal: dto.subjectLocal,
      bodyLocal: dto.bodyLocal,
      language: dto.language,
    });
    return { success: true };
  }
}
