import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { IsString, IsArray, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
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
  @IsString()
  @MinLength(1)
  projectName!: string;

  @IsArray()
  @Type(() => Object)
  leads!: Array<Record<string, unknown>>;
}

@Controller('api/settings/import-secret')
export class ImportSecretController {
  private readonly logger = new Logger(ImportSecretController.name);

  constructor(private readonly autoImportService: AutoImportService) {}

  @NeedLogin()
  @Get()
  async getImportSecret(): Promise<ImportSecretConfig> {
    return this.autoImportService.getImportSecretConfig();
  }

  @NeedLogin()
  @Post()
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
    if (!body.projectName) {
      throw new BadRequestException('projectName is required');
    }
    if (!body.leads || !Array.isArray(body.leads)) {
      throw new BadRequestException('leads must be an array');
    }
    if (body.leads.length === 0) {
      throw new BadRequestException('leads 不能为空');
    }

    return this.autoImportService.importLeads(
      body.projectName,
      body.leads,
      importSecret,
    );
  }
}
