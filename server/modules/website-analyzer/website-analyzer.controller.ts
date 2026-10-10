import {
  Controller,
  Post,
  Param,
  Body,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { WebsiteAnalyzerService } from './website-analyzer.service';
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

@UseGuards(JwtAuthGuard)
@Controller('api/website-analyzer')
export class WebsiteAnalyzerController {
  constructor(
    private readonly websiteAnalyzerService: WebsiteAnalyzerService,
  ) {}

  @Post('analyze/:companyId')
  async analyze(
    @Param('companyId') companyId: string,
  ): Promise<Company> {
    if (!companyId) {
      throw new BadRequestException('companyId 不能为空');
    }
    return this.websiteAnalyzerService.analyzeCompany(companyId);
  }

  @Post('batch-analyze')
  async batchAnalyze(
    @Body() dto: BatchAnalyzeDto,
  ): Promise<{ total: number }> {
    return this.websiteAnalyzerService.batchAnalyze(
      dto.companyIds,
      dto.projectId,
    );
  }
}
