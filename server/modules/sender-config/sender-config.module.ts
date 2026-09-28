import { Module } from '@nestjs/common';
import { SenderConfigController } from './sender-config.controller';
import { SenderConfigService } from './sender-config.service';

@Module({
  controllers: [SenderConfigController],
  providers: [SenderConfigService],
  exports: [SenderConfigService],
})
export class SenderConfigModule {}
