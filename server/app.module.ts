import { APP_FILTER } from '@nestjs/core';

process.env.BODY_SIZE_LIMIT = '30mb';

import { Inject, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { PlatformModule, DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  initServerBatchStore,
  startBatchReaper,
} from './common/utils/server-batch';

/** 批量进度持久化：启动时注入 DB 并在下次请求时续跑（续跑由各 service 触发） */
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
@Injectable()
class ServerBatchBootstrap implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async onModuleInit(): Promise<void> {
    const count = await initServerBatchStore(this.db);
    // 定时清理停滞批次（不依赖用户打开页面来触发自愈）
    startBatchReaper();
    if (count > 0) {
      // 有未完成批量：记录日志，具体续跑在各 service 的首次 getBatchStatus/batch 触发时完成
      new Logger('ServerBatch').log(
        `${count} 个未完成批量已从数据库恢复，将从断点继续`,
      );
    }
  }
}

@Module({
  providers: [ServerBatchBootstrap],
})
class ServerBatchPersistenceModule {}

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { ViewModule } from './modules/view/view.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ModelConfigModule } from './modules/model-config/model-config.module';
import { WebsiteAnalyzerModule } from './modules/website-analyzer/website-analyzer.module';
import { EmailGeneratorModule } from './modules/email-generator/email-generator.module';
import { SenderConfigModule } from './modules/sender-config/sender-config.module';
import { SenderProfilesModule } from './modules/sender-profiles/sender-profiles.module';
import { CacheMaintenanceModule } from './modules/cache-maintenance/cache-maintenance.module';
import { AutoImportModule } from './modules/auto-import/auto-import.module';
import { EmailThreadsModule } from './modules/email-threads/email-threads.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    PlatformModule.forRoot(),
    ServerBatchPersistenceModule,
    // ====== @route-section: business-modules START ======
    RestaurantsModule,
    ProjectsModule,
    ModelConfigModule,
    WebsiteAnalyzerModule,
    EmailGeneratorModule,
    SenderConfigModule,
    SenderProfilesModule,
    CacheMaintenanceModule,
    AutoImportModule,
    EmailThreadsModule,
    AuthModule,
    AdminModule,
    // ====== @route-section: business-modules END ======

    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
}) 
export class AppModule {}

