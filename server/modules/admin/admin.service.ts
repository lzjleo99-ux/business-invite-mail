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
    role: 'admin' | 'user',
  ): Promise<AdminUser> {
    if (targetUserId === currentUserId) {
      throw new ForbiddenException('不能修改自己的角色');
    }

    if (role !== 'admin' && role !== 'user') {
      throw new BadRequestException('角色值无效');
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
      role: row.role as 'admin' | 'user',
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
