import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { WebsiteAnalyzerService } from './website-analyzer.service';
import type { EmailRescanSummary } from './website-analyzer.service';
import type { Company, BatchAnalyzeRequest } from '@shared/api.interface';

class BatchAnalyzeDto implements BatchAnalyzeRequest {
  @IsOptional()
  @IsArray()
  @Type(() => String)
  companyIds?: string[];

  @IsOptional()
  @IsString()
  projectId?: string;
}

class RescanEmailsDto {
  @IsString()
  projectId!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('api/website-analyzer')
export class WebsiteAnalyzerController {
  constructor(
    private readonly websiteAnalyzerService: WebsiteAnalyzerService,
  ) {}

  /** 某公司抓到的全部联系方式（多个邮箱/电话都要列出来） */
  @Get('contacts/:companyId')
  async contacts(
    @Param('companyId') companyId: string,
  ): Promise<{ items: { type: 'email' | 'phone'; value: string; isPrimary: boolean }[] }> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    return { items: await this.websiteAnalyzerService.listContacts(companyId) };
  }

  @Post('analyze/:companyId')
  async analyze(
    @CurrentUser() user: JwtPayload,
    @Param('companyId') companyId: string,
  ): Promise<Company> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    return this.websiteAnalyzerService.analyzeCompany(companyId, user.userId);
  }

  @Post('batch-analyze')
  async batchAnalyze(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BatchAnalyzeDto,
  ): Promise<{ total: number }> {
    return this.websiteAnalyzerService.batchAnalyze(
      dto.companyIds,
      dto.projectId,
      user.userId,
    );
  }

  /**
   * 邮箱核验/挖掘：重扫项目内所有公司官网。
   * 已有邮箱的核验准确性（官网出现更优邮箱则替换），没邮箱的尝试从官网挖。
   * 纯 HTTP + 正则，不调 AI；耗时约 1-2 分钟（50 站点）。
   */
  @Post('rescan-emails')
  async rescanEmails(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RescanEmailsDto,
  ): Promise<EmailRescanSummary> {
    if (!dto.projectId) {
      throw new BadRequestException('projectId 不能为空');
    }
    return this.websiteAnalyzerService.rescanProjectEmails(dto.projectId, {
      userId: user.userId,
      role: user.role,
    });
  }
}
