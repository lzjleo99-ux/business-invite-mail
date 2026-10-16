import { Controller, Get, Patch, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { IsString, IsOptional, IsNumber, IsIn, Min, Max, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ModelConfigService } from './model-config.service';
import type {
  ModelConfig,
  UpdateModelConfigRequest,
  TestConnectionResponse,
  TestConnectionRequest,
} from '@shared/api.interface';

class TestConnectionDto implements TestConnectionRequest {
  @IsOptional()
  @IsString()
  apiBaseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(2)
  temperature?: number | null;
}

class UpdateModelConfigDto implements UpdateModelConfigRequest {
  @IsOptional()
  @IsString()
  apiBaseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(2)
  temperature?: number | null;

  @IsOptional()
  @IsString()
  @IsIn(['auto', 'serbian', 'english', 'chinese'])
  emailLanguage?: 'auto' | 'serbian' | 'english' | 'chinese';

  @IsOptional()
  @IsString()
  senderSignature?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('api/model-config')
export class ModelConfigController {
  constructor(private readonly modelConfigService: ModelConfigService) {}

  @Get()
  async getConfig(@CurrentUser() user: JwtPayload): Promise<ModelConfig> {
    return this.modelConfigService.getConfig(user.userId);
  }

  /** 可选模型列表（带中文描述），供设置页下拉框使用 */
  @Get('models')
  async listModels(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ models: Array<{ id: string; description: string }>; live: boolean }> {
    return this.modelConfigService.listModels(user.userId);
  }

  @Patch()
  async updateConfig(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateModelConfigDto,
  ): Promise<ModelConfig> {
    return this.modelConfigService.updateConfig(user.userId, dto);
  }

  @Post('test')
  async testConnection(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TestConnectionDto,
  ): Promise<TestConnectionResponse> {
    return this.modelConfigService.testConnection(user.userId, dto);
  }
}
