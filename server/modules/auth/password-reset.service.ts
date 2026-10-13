import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, gt, isNull, desc } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { appUsers, passwordResetCodes } from '@server/database/schema';
import { MailService } from '@server/common/services/mail.service';

const BCRYPT_SALT_ROUNDS = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 验证码有效期 10 分钟 */
const CODE_TTL_MINUTES = 10;
/** 同一邮箱最多允许 5 次校验尝试，防爆破 */
const MAX_VERIFY_ATTEMPTS = 5;
/** 同一邮箱两次发送的最小间隔 60 秒，防轰炸 */
const RESEND_COOLDOWN_SECONDS = 60;

export interface ForgotPasswordResult {
  sent: boolean;
  message: string;
}

/**
 * 找回密码：邮箱收验证码 → 校验后重置。
 * 安全要点：
 * - 验证码只存哈希（sha256(code:email)），库里看不到明文；
 * - 无论邮箱是否存在都返回同样的成功文案，避免探测账号；
 * - 同一邮箱 60 秒内只能发一次、校验最多 5 次、10 分钟过期；
 * - 重置成功后立即作废该验证码。
 */
@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly mailService: MailService,
  ) {}

  private hashCode(email: string, code: string): string {
    return crypto
      .createHash('sha256')
      .update(`${code}:${email}:${process.env.JWT_SECRET || 'dev'}`)
      .digest('hex');
  }

  async requestCode(email: string): Promise<ForgotPasswordResult> {
    const normalized = (email || '').toLowerCase().trim();
    const generic = '如果该邮箱已注册，验证码已发送到邮箱（10 分钟内有效）';

    if (!EMAIL_REGEX.test(normalized)) {
      throw new BadRequestException('邮箱格式不正确');
    }

    const users = await this.db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.email, normalized))
      .limit(1);

    if (users.length === 0) {
      // 不暴露账号是否存在
      return { sent: true, message: generic };
    }

    const now = Date.now();
    const recent = await this.db
      .select({ createdAt: passwordResetCodes.createdAt })
      .from(passwordResetCodes)
      .where(
        and(
          eq(passwordResetCodes.email, normalized),
          isNull(passwordResetCodes.usedAt),
          gt(passwordResetCodes.expiresAt, new Date(now)),
        ),
      )
      .orderBy(desc(passwordResetCodes.createdAt))
      .limit(1);

    if (recent.length > 0) {
      const elapsed = (now - new Date(recent[0].createdAt).getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) {
        throw new BadRequestException(
          `验证码刚发送过，请 ${Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)} 秒后再试`,
        );
      }
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

    // 历史未用验证码作废，只保留最新一条
    await this.db
      .update(passwordResetCodes)
      .set({ usedAt: new Date(now) })
      .where(
        and(
          eq(passwordResetCodes.email, normalized),
          isNull(passwordResetCodes.usedAt),
        ),
      );

    await this.db.insert(passwordResetCodes).values({
      email: normalized,
      codeHash: this.hashCode(normalized, code),
      expiresAt: new Date(now + CODE_TTL_MINUTES * 60 * 1000),
      attempts: 0,
    });

    const minutes = CODE_TTL_MINUTES;
    await this.mailService.sendMail({
      to: normalized,
      subject: `重置密码验证码：${code}`,
      text: `你的验证码是 ${code}，${minutes} 分钟内有效。如果不是本人操作，请忽略此邮件。`,
      html: `<p>你的验证码是：</p><p style="font-size:24px;font-weight:600;letter-spacing:2px">${code}</p><p>${minutes} 分钟内有效。如果不是本人操作，请忽略此邮件。</p>`,
    });

    return { sent: true, message: generic };
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    const normalized = (email || '').toLowerCase().trim();

    if (!EMAIL_REGEX.test(normalized)) {
      throw new BadRequestException('邮箱格式不正确');
    }
    if (!/^\d{6}$/.test((code || '').trim())) {
      throw new BadRequestException('验证码格式不正确');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('新密码至少 8 位');
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      throw new BadRequestException('新密码需同时包含字母和数字');
    }

    const rows = await this.db
      .select()
      .from(passwordResetCodes)
      .where(
        and(
          eq(passwordResetCodes.email, normalized),
          isNull(passwordResetCodes.usedAt),
          gt(passwordResetCodes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(passwordResetCodes.createdAt))
      .limit(1);

    if (rows.length === 0) {
      throw new BadRequestException('验证码不存在或已过期，请重新获取');
    }

    const row = rows[0];
    if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
      await this.db
        .update(passwordResetCodes)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetCodes.id, row.id));
      throw new BadRequestException('验证码尝试次数过多，请重新获取');
    }

    const expected = this.hashCode(normalized, (code || '').trim());
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(row.codeHash, 'utf8');
    const matched = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!matched) {
      await this.db
        .update(passwordResetCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(passwordResetCodes.id, row.id));
      const left = MAX_VERIFY_ATTEMPTS - (row.attempts + 1);
      throw new BadRequestException(
        left > 0 ? `验证码不正确，还可尝试 ${left} 次` : '验证码不正确，请重新获取',
      );
    }

    const users = await this.db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.email, normalized))
      .limit(1);
    if (users.length === 0) {
      throw new BadRequestException('该邮箱未注册');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await this.db
      .update(appUsers)
      .set({ passwordHash })
      .where(eq(appUsers.id, users[0].id));
    await this.db
      .update(passwordResetCodes)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetCodes.id, row.id));

    return { success: true };
  }
}