import { Module } from '@nestjs/common';
import { ModelConfigController } from './model-config.controller';
import { ModelConfigService } from './model-config.service';
import { ModelBalanceService } from './model-balance.service';

@Module({
  controllers: [ModelConfigController],
  providers: [ModelConfigService, ModelBalanceService],
  exports: [ModelConfigService],
})
export class ModelConfigModule {}
