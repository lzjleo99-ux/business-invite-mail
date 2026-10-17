import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  BadRequestException,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { EmailGeneratorService } from './email-generator.service';
import type {
  GeneratedEmail,
  BatchGenerateRequest,
  EmlDownloadResponse,
  WhatsAppInfo,
  BatchWhatsAppRequest,
} from '@shared/api.interface';

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
