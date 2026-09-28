import { Module } from '@nestjs/common';
import { EmailThreadsController } from './email-threads.controller';
import { EmailThreadsService } from './email-threads.service';

@Module({
  controllers: [EmailThreadsController],
  providers: [EmailThreadsService],
  exports: [EmailThreadsService],
})
export class EmailThreadsModule {}
