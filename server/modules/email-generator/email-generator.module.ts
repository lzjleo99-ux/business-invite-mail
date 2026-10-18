import { Module } from '@nestjs/common';
import { EmailGeneratorController } from './email-generator.controller';
import { EmailGeneratorService } from './email-generator.service';
import { WeatherService } from '../../common/services/weather.service';
import { SharedMailModule } from '@server/common/mail.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [ProjectsModule, SharedMailModule],
  controllers: [EmailGeneratorController],
  providers: [EmailGeneratorService, WeatherService],
})
export class EmailGeneratorModule {}
