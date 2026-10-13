import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordResetService } from './password-reset.service';
import { MailService } from '@server/common/services/mail.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PasswordResetService, MailService],
  exports: [AuthService, JwtAuthGuard, PasswordResetService, MailService],
})
export class AuthModule {}
