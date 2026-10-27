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
import { and, asc, eq, count, isNull, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { appUsers, projects } from '@server/database/schema';
import { getDdlRunner } from '@server/common/utils/ddl-runner';
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

  /** 角色自愈迁移的 memoize：进程内只跑一次 */
  private roleFixPromise?: Promise<void>;

  /**
   * 多租户隔离前置条件：**部署所有者 = 最早注册的用户 = 唯一 super_admin**。
   * 实际发生过两次倒挂：① 同事被建成了 super_admin（全量可见）；② 真正的
   * 所有者反而是 admin。此迁移按 createdAt 找到最早的注册用户：
   *   - 把它设为 super_admin（无论当前是什么角色）；
   *   - 其他任何 super_admin 一律降为 user。
   * 登录路径触发（幂等，memoize 后零开销）。
   */
  ensureSingleSuperAdmin(): Promise<void> {
    if (!this.roleFixPromise) {
      this.roleFixPromise = this.runTenantBootstrap().then(() => undefined).catch((err: unknown) => {
        this.roleFixPromise = undefined;
        throw err;
      });
    }
    return this.roleFixPromise;
  }

  /**
   * 租户自愈迁移（诊断端点可强制重跑）：角色收敛 + 机器人代建项目归属 +
   * 团队成员 AI 配置回填。返回执行统计。
   */
  async runTenantBootstrap(force = false): Promise<{
    owner: string; roleChanges: string[]; transferred: number; backfilled: number;
  }> {
    if (force) this.roleFixPromise = undefined;
    if (!force && this.roleFixPromise) {
      await this.roleFixPromise;
      return { owner: 'cached', roleChanges: [], transferred: 0, backfilled: 0 };
    }
    return (async () => {
        const roleChanges: string[] = [];
        const all = await this.db
          .select({ id: appUsers.id, email: appUsers.email, role: appUsers.role })
          .from(appUsers)
          .orderBy(asc(appUsers.createdAt));
        if (all.length === 0) return { owner: '-', roleChanges: [], transferred: 0, backfilled: 0 };
        const owner = all[0]; // 最早注册 = 部署所有者
        for (const u of all) {
          if (u.id === owner.id) {
            if (u.role !== 'super_admin') {
              await this.db
                .update(appUsers)
                .set({ role: 'super_admin' })
                .where(eq(appUsers.id, u.id));
              roleChanges.push(`${u.email} -> super_admin`);
              this.logger.warn(
                `多租户隔离：部署所有者 ${u.email} 提升为 super_admin`,
              );
            }
          } else if (u.role === 'super_admin') {
            await this.db
              .update(appUsers)
              .set({ role: 'user' })
              .where(eq(appUsers.id, u.id));
            roleChanges.push(`${u.email} -> user`);
            this.logger.warn(
              `多租户隔离：${u.email} 从 super_admin 降级为 user（部署所有者是 ${owner.email}）`,
            );
          }
        }
        let transferred = 0;
        let backfilled = 0;
        // 机器人代建的项目归部署所有者：机器人导入的 owner 解析指向
        // super_admin，历史数据可能落在别人名下（WM0923 事件）。幂等搬正。
        //
        // 必须走**属主连接**：projects 有平台 RLS，请求角色（用户自己）的
        // WITH CHECK 会拒绝把 owner_id 改成别人——静默 0 行。属主连接
        // 绕过 RLS（与 DDL 同理）。
        const ownerRow = await this.db
          .select({ id: appUsers.id })
          .from(appUsers)
          .orderBy(asc(appUsers.createdAt))
          .limit(1);
        const ownerId = ownerRow[0]?.id;
        if (!ownerId) return;
        const runner = await getDdlRunner(
          { $client: null, session: null },
          '机器人代建项目归属迁移',
        );
        try {
          const moved = await runner.run(
            `UPDATE projects SET owner_id = '${ownerId}'
             WHERE description = 'Auto-created by auto-import'
               AND owner_id IS DISTINCT FROM '${ownerId}'::uuid RETURNING id`,
          );
          transferred = Array.isArray(moved) ? (moved as unknown[]).length : 0;
          // 团队成员的 AI 配置回填：从部署所有者的行复制（仅限从未配置过的行，
          // api_key 为空），让新成员拿到能用的 Key/签名做起点。GitHub fork 模式。
          const bf = await runner.run(
            `WITH owner_cfg AS (
               SELECT mc.api_base_url, mc.api_key, mc.model_name, mc.email_language, mc.sender_signature
               FROM model_config mc
               WHERE (mc._created_by).user_id = (SELECT id FROM app_users ORDER BY _created_at ASC LIMIT 1)
             )
             UPDATE model_config mc
             SET api_base_url = o.api_base_url,
                 api_key = o.api_key,
                 model_name = o.model_name,
                 email_language = o.email_language,
                 sender_signature = o.sender_signature
             FROM owner_cfg o
             WHERE (mc._created_by).user_id <> (SELECT id FROM app_users ORDER BY _created_at ASC LIMIT 1)
               AND (mc.api_key IS NULL OR mc.api_key = '') RETURNING id`,
          );
          backfilled = Array.isArray(bf) ? (bf as unknown[]).length : 0;
        } finally {
          await runner.dispose();
        }
        return { owner: owner.email, roleChanges, transferred, backfilled };
      })().catch((err: unknown) => {
        this.roleFixPromise = undefined;
        throw err;
      });
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    await this.ensureSingleSuperAdmin().catch(() => undefined);
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
