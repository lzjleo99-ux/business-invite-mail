import { Module } from '@nestjs/common';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import {
  ImportSecretController,
  AutoImportController,
} from './auto-import.controller';
import { AutoImportService } from './auto-import.service';

@Module({
  imports: [RestaurantsModule],
  controllers: [ImportSecretController, AutoImportController],
  providers: [AutoImportService],
  exports: [AutoImportService],
})
export class AutoImportModule {}
