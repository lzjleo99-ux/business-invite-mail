import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { MaterialBlobService } from './material-blob.service';
import { ImageAnalysisService } from './image-analysis.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, MaterialBlobService, ImageAnalysisService],
  // EmailGeneratorModule 生成邮件时要读图片候选、EML 要内嵌图片字节
  exports: [MaterialBlobService, ImageAnalysisService],
})
export class ProjectsModule {}
