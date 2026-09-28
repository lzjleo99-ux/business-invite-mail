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
} from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Response } from 'express';
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

@Controller('api/email-generator')
export class EmailGeneratorController {
  constructor(
    private readonly emailGeneratorService: EmailGeneratorService,
  ) {}

  @Post('generate/:companyId')
  async generate(
    @Param('companyId') companyId: string,
  ): Promise<GeneratedEmail> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    return this.emailGeneratorService.generateEmail(companyId);
  }

  @Post('batch-generate')
  async batchGenerate(
    @Body() dto: BatchGenerateDto,
  ): Promise<{ total: number }> {
    return this.emailGeneratorService.batchGenerate(
      dto.companyIds,
      dto.projectId,
    );
  }

  @Get('eml/:companyId')
  async getEml(
    @Param('companyId') companyId: string,
    @Res() res: Response,
  ): Promise<void> {
    const result: EmlDownloadResponse = await this.emailGeneratorService.getEml(companyId);
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
    @Param('companyId') companyId: string,
  ): Promise<WhatsAppInfo> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    return this.emailGeneratorService.generateWhatsAppForCompany(companyId);
  }

  @Post('batch-whatsapp')
  async batchWhatsApp(
    @Body() dto: BatchWhatsAppDto,
  ): Promise<{ total: number }> {
    return this.emailGeneratorService.batchPrepareWhatsApp(dto.projectId);
  }

  @NeedLogin()
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

  @NeedLogin()
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
