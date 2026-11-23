import { Module } from '@nestjs/common';
import { SuppressionService } from './suppression.service';
import { UnsubscribeController, UnsubscribeAdminController } from './unsubscribe.controller';

@Module({
  controllers: [UnsubscribeController, UnsubscribeAdminController],
  providers: [SuppressionService],
  exports: [SuppressionService],
})
export class UnsubscribeModule {}
