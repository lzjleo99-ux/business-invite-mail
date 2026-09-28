import { Module } from '@nestjs/common';
import { WebsiteAnalyzerController } from './website-analyzer.controller';
import { WebsiteAnalyzerService } from './website-analyzer.service';

@Module({
  controllers: [WebsiteAnalyzerController],
  providers: [WebsiteAnalyzerService],
})
export class WebsiteAnalyzerModule {}
