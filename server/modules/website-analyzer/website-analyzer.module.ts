import { Module } from '@nestjs/common';
import { ComplianceModule } from '@server/modules/compliance/compliance.module';
import { WebsiteAnalyzerController } from './website-analyzer.controller';
import { WebsiteAnalyzerService } from './website-analyzer.service';

@Module({
  imports: [ComplianceModule],
  controllers: [WebsiteAnalyzerController],
  providers: [WebsiteAnalyzerService],
})
export class WebsiteAnalyzerModule {}
