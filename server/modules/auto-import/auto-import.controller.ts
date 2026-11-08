import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  UseGuards,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { IsString, IsArray, MinLength, IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '@server/common/guards/admin.guard';
import { AutoImportService } from './auto-import.service';
import type {
  ImportSecretConfig,
  UpdateImportSecretRequest,
  AutoImportResponse,
} from '@shared/api.interface';

class UpdateImportSecretDto implements UpdateImportSecretRequest {
  @IsString()
  @MinLength(6)
  importSecret!: string;
}

class AutoImportBodyDto {
  /** 可以为空：机器人未指定项目时传 autoName=true，由服务端 AI 命名 */
  @IsOptional()
  @IsString()
  projectName?: string;

  /** 可选：机器人项目代码（FF1357）。给了就按代码定位项目，名字只作展示兜底。 */
  @IsOptional()
  @IsString()
  projectCode?: string;

  /** 让服务端根据线索内容自动生成项目名 */
  @IsOptional()
  @IsBoolean()
  autoName?: boolean;

  /** 用户原始指令（AI 命名参考，例如「搜索塞尔维亚的100个模具工厂…」） */
  @IsOptional()
  @IsString()
  sourceHint?: string;

  @IsArray()
  @Type(() => Object)
  leads!: Array<Record<string, unknown>>;
}

// 用应用自己的 JwtAuthGuard（与其余业务接口一致）。平台 @NeedLogin() 依赖
// 平台会话 userContext，自建部署下永远 401，机器人对接将无法激活。
@UseGuards(JwtAuthGuard)
@Controller('api/settings/import-secret')
export class ImportSecretController {
  private readonly logger = new Logger(ImportSecretController.name);

  constructor(private readonly autoImportService: AutoImportService) {}

  @Get()
  async getImportSecret(): Promise<ImportSecretConfig> {
    return this.autoImportService.getImportSecretConfig();
  }

  @Post()
  @UseGuards(AdminGuard)
  async setImportSecret(
    @Body() dto: UpdateImportSecretDto,
  ): Promise<ImportSecretConfig> {
    return this.autoImportService.setImportSecret(dto.importSecret);
  }
}

@Controller('openapi/auto-import/leads')
export class AutoImportController {
  private readonly logger = new Logger(AutoImportController.name);

  constructor(private readonly autoImportService: AutoImportService) {}

  @Post()
  async importLeads(
    @Headers('X-Import-Secret') importSecret: string | undefined,
    @Body() body: AutoImportBodyDto,
  ): Promise<AutoImportResponse> {
    if (!body.autoName && !body.projectName?.trim()) {
      throw new BadRequestException('projectName is required (or set autoName=true)');
    }
    if (!body.leads || !Array.isArray(body.leads)) {
      throw new BadRequestException('leads must be an array');
    }
    if (body.leads.length === 0) {
      throw new BadRequestException('leads 不能为空');
    }

    return this.autoImportService.importLeads(
      body.projectName ?? '',
      body.leads,
      importSecret,
      body.projectCode,
      { autoName: body.autoName, sourceHint: body.sourceHint },
    );
  }
}
