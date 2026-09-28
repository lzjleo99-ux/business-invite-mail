import { Controller, Get, Patch, Body } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { SenderConfigService } from './sender-config.service';
import type {
  SenderConfig,
  UpdateSenderConfigRequest,
} from '@shared/api.interface';

class UpdateSenderConfigDto implements UpdateSenderConfigRequest {
  @IsOptional()
  @IsString()
  senderName?: string;

  @IsOptional()
  @IsString()
  senderTitle?: string;

  @IsOptional()
  @IsString()
  personalStory?: string;
}

@Controller('api/sender-config')
export class SenderConfigController {
  constructor(private readonly senderConfigService: SenderConfigService) {}

  @Get()
  async getConfig(): Promise<SenderConfig> {
    return this.senderConfigService.getConfig();
  }

  @Patch()
  async updateConfig(
    @Body() dto: UpdateSenderConfigDto,
  ): Promise<SenderConfig> {
    return this.senderConfigService.updateConfig(dto);
  }
}
