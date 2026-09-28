import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc } from 'drizzle-orm';
import { emailThreads } from '@server/database/schema';
import type {
  EmailThread,
  CreateEmailThreadRequest,
  EmailThreadListResponse,
} from '@shared/api.interface';

@Injectable()
export class EmailThreadsService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async listByCompanyId(companyId: string): Promise<EmailThreadListResponse> {
    if (!companyId) {
      throw new BadRequestException('缺少 companyId');
    }

    const whereClause = eq(emailThreads.companyId, companyId);

    const [countResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(emailThreads)
        .where(whereClause),
      this.db
        .select()
        .from(emailThreads)
        .where(whereClause)
        .orderBy(desc(emailThreads.threadDate), desc(emailThreads.createdAt)),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((r) => this.mapRowToThread(r)),
      total,
    };
  }

  async create(
    data: CreateEmailThreadRequest,
    userId: string,
  ): Promise<EmailThread> {
    if (!data.companyId) {
      throw new BadRequestException('缺少 companyId');
    }
    if (!data.projectId) {
      throw new BadRequestException('缺少 projectId');
    }
    if (!data.threadDate) {
      throw new BadRequestException('缺少 threadDate');
    }
    if (!data.content || !data.content.trim()) {
      throw new BadRequestException('缺少 content');
    }

    const direction = data.direction ?? 'outbound';

    const inserted = await this.db
      .insert(emailThreads)
      .values({
        companyId: data.companyId,
        projectId: data.projectId,
        threadDate: data.threadDate,
        content: data.content.trim(),
        direction,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    return this.mapRowToThread(inserted[0]);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db
      .delete(emailThreads)
      .where(eq(emailThreads.id, id))
      .returning({ id: emailThreads.id });

    if (deleted.length === 0) {
      throw new NotFoundException('往来记录不存在');
    }
  }

  private mapRowToThread(
    row: typeof emailThreads.$inferSelect,
  ): EmailThread {
    return {
      id: row.id,
      companyId: row.companyId,
      projectId: row.projectId,
      threadDate: row.threadDate,
      content: row.content,
      direction: row.direction as 'inbound' | 'outbound' | 'note',
      createdAt: row.createdAt.toISOString(),
    };
  }
}
