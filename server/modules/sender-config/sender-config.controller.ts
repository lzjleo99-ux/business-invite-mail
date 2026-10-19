import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
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

@UseGuards(JwtAuthGuard)
@Controller('api/sender-config')
export class SenderConfigController {
  constructor(private readonly senderConfigService: SenderConfigService) {}

  @Get()
  async getConfig(@CurrentUser() user: JwtPayload): Promise<SenderConfig> {
    return this.senderConfigService.getConfig(user.userId);
  }

  @Patch()
  async updateConfig(
    @Body() dto: UpdateSenderConfigDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<SenderConfig> {
    return this.senderConfigService.updateConfig(dto, user.userId);
  }
}
