import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { MaterialBlobService } from './material-blob.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, MaterialBlobService],
})
export class ProjectsModule {}