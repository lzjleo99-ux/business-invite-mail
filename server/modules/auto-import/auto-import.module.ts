import { Module } from '@nestjs/common';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import {
  ImportSecretController,
  AutoImportController,
} from './auto-import.controller';
import { AutoImportService } from './auto-import.service';
import { ProjectNamingService } from './project-naming.service';

@Module({
  imports: [RestaurantsModule],
  controllers: [ImportSecretController, AutoImportController],
  providers: [AutoImportService, ProjectNamingService],
  exports: [AutoImportService],
})
export class AutoImportModule {}
