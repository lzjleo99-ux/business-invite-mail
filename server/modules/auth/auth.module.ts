import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordResetService } from './password-reset.service';
import { SharedMailModule } from '@server/common/mail.module';

@Module({
  imports: [SharedMailModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PasswordResetService],
  // re-export SharedMailModule：AdminModule 经由这里拿到 MailService
  exports: [AuthService, JwtAuthGuard, PasswordResetService, SharedMailModule],
})
export class AuthModule {}
