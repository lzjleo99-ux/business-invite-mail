import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

process.env.BODY_SIZE_LIMIT = '30mb';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { ViewModule } from './modules/view/view.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ModelConfigModule } from './modules/model-config/model-config.module';
import { WebsiteAnalyzerModule } from './modules/website-analyzer/website-analyzer.module';
import { EmailGeneratorModule } from './modules/email-generator/email-generator.module';
import { SenderConfigModule } from './modules/sender-config/sender-config.module';
import { AutoImportModule } from './modules/auto-import/auto-import.module';
import { EmailThreadsModule } from './modules/email-threads/email-threads.module';

@Module({
  imports: [
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    RestaurantsModule,
    ProjectsModule,
    ModelConfigModule,
    WebsiteAnalyzerModule,
    EmailGeneratorModule,
    SenderConfigModule,
    AutoImportModule,
    EmailThreadsModule,
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

