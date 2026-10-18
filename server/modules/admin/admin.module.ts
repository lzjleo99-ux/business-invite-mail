import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '@server/modules/auth/auth.module';
import { EmailGeneratorModule } from '@server/modules/email-generator/email-generator.module';
import { AdminGuard } from '@server/common/guards/admin.guard';

@Module({
  imports: [AuthModule, EmailGeneratorModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
  exports: [AdminService],
})
export class AdminModule {}
