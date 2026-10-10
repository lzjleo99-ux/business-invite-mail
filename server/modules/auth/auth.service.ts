import {
  Injectable,
  Inject,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, count, isNull } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { appUsers, projects } from '@server/database/schema';
import type {
  AuthUser,
  AuthResponse,
  ChangePasswordRequest,
} from '@shared/api.interface';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = '7d';
const BCRYPT_SALT_ROUNDS = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AuthResponse> {
    const normalizedEmail = email.toLowerCase().trim();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      throw new BadRequestException('邮箱格式不正确');
    }

    this.validatePasswordStrength(password);

    if (!displayName || displayName.trim().length === 0) {
      throw new BadRequestException('显示名称不能为空');
    }

    const existing = await this.db
      .select()
      .from(appUsers)
      .where(eq(appUsers.email, normalizedEmail))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException('该邮箱已被注册');
    }

    const [{ userCount }] = await this.db
      .select({ userCount: count() })
      .from(appUsers);

    const role = userCount === 0 ? 'admin' : 'user';
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const inserted = await this.db
      .insert(appUsers)
      .values({
        email: normalizedEmail,
        passwordHash,
        displayName: displayName.trim(),
        role,
        isActive: true,
      })
      .returning();

    const newUser = inserted[0];
    const user = this.toAuthUser(newUser);
    const token = this.signToken(user);

    if (role === 'admin') {
      try {
        await this.db
          .update(projects)
          .set({ ownerId: user.id })
          .where(isNull(projects.ownerId));
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to assign orphan projects to first admin: ${String(err)}`,
        );
      }
    }

    return { user, token };
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const normalizedEmail = email.toLowerCase().trim();

    const rows = await this.db
      .select()
      .from(appUsers)
      .where(eq(appUsers.email, normalizedEmail))
      .limit(1);

    if (rows.length === 0) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const row = rows[0];
    const passwordValid = await bcrypt.compare(password, row.passwordHash);

    if (!passwordValid) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    if (!row.isActive) {
      throw new UnauthorizedException('账号已被禁用');
    }

    const user = this.toAuthUser(row);
    const token = this.signToken(user);

    return { user, token };
  }

  async me(userId: string): Promise<AuthUser> {
    const rows = await this.db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);

    if (rows.length === 0) {
      throw new UnauthorizedException('用户不存在');
    }

    return this.toAuthUser(rows[0]);
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    this.validatePasswordStrength(newPassword);

    const rows = await this.db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);

    if (rows.length === 0) {
      throw new UnauthorizedException('用户不存在');
    }

    const row = rows[0];
    const oldPasswordValid = await bcrypt.compare(oldPassword, row.passwordHash);

    if (!oldPasswordValid) {
      throw new BadRequestException('旧密码不正确');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

    await this.db
      .update(appUsers)
      .set({ passwordHash: newPasswordHash })
      .where(eq(appUsers.id, userId));

    return { success: true };
  }

  validateToken(token: string): { userId: string; email: string; role: 'admin' | 'user'; displayName: string } | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as {
        userId: string;
        email: string;
        role: 'admin' | 'user';
        displayName: string;
      };
      return payload;
    } catch {
      return null;
    }
  }

  private signToken(user: AuthUser): string {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );
  }

  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new BadRequestException('密码长度至少为8位');
    }
    if (!/[a-zA-Z]/.test(password)) {
      throw new BadRequestException('密码必须包含字母');
    }
    if (!/\d/.test(password)) {
      throw new BadRequestException('密码必须包含数字');
    }
  }

  private toAuthUser(row: typeof appUsers.$inferSelect): AuthUser {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role as 'admin' | 'user',
      isActive: row.isActive,
    };
  }
}
