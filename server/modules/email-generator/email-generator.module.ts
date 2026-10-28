import { Module } from '@nestjs/common';
import { EmailGeneratorController } from './email-generator.controller';
import { EmailGeneratorService } from './email-generator.service';
import { WeatherService } from '../../common/services/weather.service';
import { SharedMailModule } from '@server/common/mail.module';
import { ProjectsModule } from '../projects/projects.module';
import { EmailHistoryService } from './email-history.service';
import { EmailInboxService } from './email-inbox.service';
import { WeComNotifyService } from './wecom-notify.service';
import { SenderProfilesModule } from '@server/modules/sender-profiles/sender-profiles.module';
import { MessengerService } from './messenger.service';

@Module({
  imports: [ProjectsModule, SharedMailModule, SenderProfilesModule],
  controllers: [EmailGeneratorController],
  providers: [
    EmailGeneratorService,
    WeatherService,
    EmailHistoryService,
    EmailInboxService,
    WeComNotifyService,
    MessengerService,
  ],
  // AdminModule 的设置保存要热更新收信轮询，必须显式导出，
  // 否则 Nest 启动时解析不了 AdminController 的依赖 → 容器崩溃循环（503）。
  exports: [EmailInboxService, WeComNotifyService],
})
export class EmailGeneratorModule {}
