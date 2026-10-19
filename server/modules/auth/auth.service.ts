import type { UserRole } from '@shared/api.interface';
import {
  Injectable,
  Inject,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, eq, count, isNull } from 'drizzle-orm';
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
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AuthResponse> {
    return this.createUser(email, password, displayName, null);
  }

  /** 管理员创建账号：角色固定为普通用户，不参与"首个账号=admin"的判定 */
  async createUserByAdmin(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AuthResponse> {
    return this.createUser(email, password, displayName, 'user');
  }

  /** 是否还没有任何账号（用于首次部署时放行自注册以创建 admin） */
  async hasAnyUser(): Promise<boolean> {
    const [{ userCount }] = await this.db
      .select({ userCount: count() })
      .from(appUsers);
    return userCount > 0;
  }

  private async createUser(
    email: string,
    password: string,
    displayName: string,
    forcedRole: UserRole | null,
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

    // 第一个用户直接是超级管理员（系统里唯一的那个）
    const role: UserRole = forcedRole ?? (userCount === 0 ? 'super_admin' : 'user');
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

    if (role === 'super_admin') {
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

  /**
   * 启动自愈：系统里必须恰好有一个 super_admin。
   * 升级到三级角色时，存量账号都是 admin/user——如果没有 super_admin，
   * 就把最早创建的 admin 提上来，否则那个账号会突然失去跨用户可见性。
   * 幂等：已经有 super_admin 就什么都不做。
   */
  async onModuleInit(): Promise<void> {
    try {
      const supers = await this.db
        .select({ id: appUsers.id })
        .from(appUsers)
        .where(eq(appUsers.role, 'super_admin'))
        .limit(1);
      if (supers.length > 0) return;

      const admins = await this.db
        .select({ id: appUsers.id, createdAt: appUsers.createdAt })
        .from(appUsers)
        .where(eq(appUsers.role, 'admin'))
        .orderBy(asc(appUsers.createdAt))
        .limit(1);
      if (admins.length === 0) return;

      await this.db
        .update(appUsers)
        .set({ role: 'super_admin' })
        .where(eq(appUsers.id, admins[0].id));
      this.logger.log(
        `启动自愈：系统中没有超级管理员，已将最早的 admin（${admins[0].id}）提升为 super_admin`,
      );
    } catch (err: unknown) {
      // 不能因为自愈失败挡住启动（表可能还没建）
      this.logger.warn(`super_admin 自愈检查失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  validateToken(token: string): { userId: string; email: string; role: UserRole; displayName: string } | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as {
        userId: string;
        email: string;
        role: UserRole;
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
      role: row.role as UserRole,
      isActive: row.isActive,
    };
  }
}
