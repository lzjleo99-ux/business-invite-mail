import type { UserRole } from '@shared/api.interface';
import {
  Injectable,
  Inject,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, count, or, ilike, desc } from 'drizzle-orm';
import { appUsers } from '@server/database/schema';
import type {
  AdminUser,
  AdminUserListResponse,
} from '@shared/api.interface';

@Injectable()
export class AdminService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async listUsers(
    page: number,
    pageSize: number,
    search?: string,
  ): Promise<AdminUserListResponse> {
    const offset = (page - 1) * pageSize;

    const whereConditions = search
      ? or(
          ilike(appUsers.email, `%${search}%`),
          ilike(appUsers.displayName, `%${search}%`),
        )
      : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(appUsers)
        .where(whereConditions)
        .orderBy(desc(appUsers.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(appUsers)
        .where(whereConditions),
    ]);

    const total = Number(totalRows[0].count);

    return {
      items: rows.map((row) => this.toAdminUser(row)),
      total,
    };
  }

  async updateRole(
    targetUserId: string,
    currentUserId: string,
    role: UserRole,
  ): Promise<AdminUser> {
    if (targetUserId === currentUserId) {
      throw new ForbiddenException('不能修改自己的角色');
    }

    if (role !== 'admin' && role !== 'user') {
      throw new BadRequestException('角色值无效');
    }

    // 超级管理员身份只能通过专用接口转移，这里不允许直接改动
    const target = await this.db
      .select({ role: appUsers.role })
      .from(appUsers)
      .where(eq(appUsers.id, targetUserId))
      .limit(1);
    if (target[0]?.role === 'super_admin') {
      throw new ForbiddenException('不能修改超级管理员的角色');
    }

    const updated = await this.db
      .update(appUsers)
      .set({ role })
      .where(eq(appUsers.id, targetUserId))
      .returning();

    if (updated.length === 0) {
      throw new NotFoundException('用户不存在');
    }

    return this.toAdminUser(updated[0]);
  }

  /**
   * 把指定用户设为唯一的超级管理员：先把现任 super_admin 降级为 admin，
   * 再提升目标用户。保证任何时刻全系统只有一个 super_admin。
   */
  async setSuperAdmin(targetUserId: string): Promise<void> {
    const target = await this.db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.id, targetUserId))
      .limit(1);
    if (target.length === 0) throw new NotFoundException('用户不存在');

    // 先降级现任（可能有多个历史遗留，统一处理）
    await this.db.update(appUsers).set({ role: 'admin' }).where(eq(appUsers.role, 'super_admin'));
    await this.db.update(appUsers).set({ role: 'super_admin' }).where(eq(appUsers.id, targetUserId));
  }

  async updateActive(
    targetUserId: string,
    currentUserId: string,
    isActive: boolean,
  ): Promise<AdminUser> {
    if (targetUserId === currentUserId) {
      throw new ForbiddenException('不能禁用或启用自己的账号');
    }

    const updated = await this.db
      .update(appUsers)
      .set({ isActive })
      .where(eq(appUsers.id, targetUserId))
      .returning();

    if (updated.length === 0) {
      throw new NotFoundException('用户不存在');
    }

    return this.toAdminUser(updated[0]);
  }

  private toAdminUser(row: typeof appUsers.$inferSelect): AdminUser {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role as UserRole,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
