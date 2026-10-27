import { Module } from '@nestjs/common';
import { SenderProfilesController } from './sender-profiles.controller';
import { SenderProfilesPublicController } from './sender-profiles-public.controller';
import { SenderProfilesService } from './sender-profiles.service';

@Module({
  controllers: [SenderProfilesController, SenderProfilesPublicController],
  providers: [SenderProfilesService],
  exports: [SenderProfilesService],
})
export class SenderProfilesModule {}
