import { Module } from '@nestjs/common';
import { MailService } from '@server/common/services/mail.service';

/**
 * MailService 的唯一提供模块。
 * SMTP 配置是全局单行（密码重置与 BD 群发共用一套发信服务），
 * NestJS 的 injectable-should-be-provided 规则要求一个 Injectable 只在
 * 一个 module 里 provide —— 谁用谁 import 这个模块。
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class SharedMailModule {}
