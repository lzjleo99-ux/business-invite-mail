import { Module } from '@nestjs/common';
import { SenderProfilesController } from './sender-profiles.controller';
import { SenderProfilesService } from './sender-profiles.service';

@Module({
  controllers: [SenderProfilesController],
  providers: [SenderProfilesService],
  exports: [SenderProfilesService],
})
export class SenderProfilesModule {}
