import { Controller, Get, Patch, Post, Body } from '@nestjs/common';
import { IsString, IsOptional, IsNumber, IsIn, Min, Max, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ModelConfigService } from './model-config.service';
import type {
  ModelConfig,
  UpdateModelConfigRequest,
  TestConnectionRequest,
  TestConnectionResponse,
} from '@shared/api.interface';

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

@Controller('api/model-config')
export class ModelConfigController {
  constructor(private readonly modelConfigService: ModelConfigService) {}

  @Get()
  async getConfig(): Promise<ModelConfig> {
    return this.modelConfigService.getConfig();
  }

  @Patch()
  async updateConfig(
    @Body() dto: UpdateModelConfigDto,
  ): Promise<ModelConfig> {
    return this.modelConfigService.updateConfig(dto);
  }

  @Post('test')
  async testConnection(
    @Body() dto: TestConnectionDto,
  ): Promise<TestConnectionResponse> {
    return this.modelConfigService.testConnection(dto);
  }
}
