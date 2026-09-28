import { Module } from '@nestjs/common';
import { EmailGeneratorController } from './email-generator.controller';
import { EmailGeneratorService } from './email-generator.service';
import { WeatherService } from '../../common/services/weather.service';

@Module({
  controllers: [EmailGeneratorController],
  providers: [EmailGeneratorService, WeatherService],
})
export class EmailGeneratorModule {}
