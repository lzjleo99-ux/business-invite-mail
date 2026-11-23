import { Module } from '@nestjs/common';
import { SuppressionService } from './suppression.service';
import { UnsubscribeController } from './unsubscribe.controller';

@Module({
  controllers: [UnsubscribeController],
  providers: [SuppressionService],
  exports: [SuppressionService],
})
export class UnsubscribeModule {}
