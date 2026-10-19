import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { senderConfig } from '@server/database/schema';
import type {
  SenderConfig,
  UpdateSenderConfigRequest,
} from '@shared/api.interface';

const DEFAULT_SENDER_NAME = 'Zijian Lang';
const DEFAULT_SENDER_TITLE = 'Global Sourcing Specialist';
const DEFAULT_PERSONAL_STORY =
  'I earned my MSc in Logistics and Supply Chain Management from Cranfield University in the UK, ' +
  'where I developed a deep understanding of global sourcing strategies and international trade. ' +
  'After graduation, I spent several years working in procurement for multinational companies, ' +
  'building strong relationships with suppliers across Europe and Asia. ' +
  'My international background and cross-cultural communication skills allow me to bridge the gap ' +
  'between Eastern manufacturing expertise and Western quality expectations, ' +
  'helping partners find reliable, cost-effective sourcing solutions.';

@Injectable()
export class SenderConfigService {
  private readonly logger = new Logger(SenderConfigService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * 发件人签名改为每用户一份。
   *
   * 之前是 `select * from sender_config limit 1` —— 全局单行，任何人改签名都会覆盖所有人。
   *
   * sender_config 是**平台表**（带 _created_by 系统列），应用用户 ALTER 会报
   * "must be owner of table"，所以不能加 owner_id 列；改用平台自带的 _created_by
   * 复合类型做归属：插入写 ROW('uid'::text)，过滤用 (_created_by).user_id = 'uid'。
   * 老行 _created_by IS NULL 仍作为全局回退，升级不破坏现有签名。
   */
  private ownedBy(userId: string) {
    return sql`(${senderConfig.createdBy}).user_id = ${userId}`;
  }

  async getConfig(userId?: string): Promise<SenderConfig> {
    const rows = userId
      ? await this.db
          .select()
          .from(senderConfig)
          .where(or(this.ownedBy(userId), isNull(senderConfig.createdBy)))
          // 自己的排前面，保证不会被全局回退行盖掉
          .orderBy(sql`(${senderConfig.createdBy}) is null asc`)
          .limit(1)
      : await this.db
          .select()
          .from(senderConfig)
          .where(isNull(senderConfig.createdBy))
          .limit(1);

    if (rows.length > 0) {
      return this.toResponse(rows[0]);
    }

    // 没有任何行 → 为该用户建一份。
    // 注意：不要手动写 _created_by —— 平台会自动用当前请求的 app.user_id 填它
    // （schema 里是 userProfile("_created_by").default(...)），手写反而违反平台约定。
    const inserted = await this.db
      .insert(senderConfig)
      .values({
        senderName: DEFAULT_SENDER_NAME,
        senderTitle: DEFAULT_SENDER_TITLE,
        personalStory: DEFAULT_PERSONAL_STORY,
      })
      .returning();

    return this.toResponse(inserted[0]);
  }

  async updateConfig(
    data: UpdateSenderConfigRequest,
    userId?: string,
  ): Promise<SenderConfig> {
    const existing = await this.getConfig(userId);

    const patch: Partial<typeof senderConfig.$inferInsert> = {};
    if (data.senderName !== undefined) patch.senderName = data.senderName;
    if (data.senderTitle !== undefined) patch.senderTitle = data.senderTitle;
    if (data.personalStory !== undefined) patch.personalStory = data.personalStory;

    if (Object.keys(patch).length === 0) {
      return existing;
    }

    if (userId) {
      // 用户自己的行：直接改
      const own = await this.db
        .update(senderConfig)
        .set(patch)
        .where(this.ownedBy(userId))
        .returning();
      if (own[0]) return this.toResponse(own[0]);

      // 之前拿到的是全局回退行 → **新建一行属于自己的**，不去改那行。
      // （改全局行会让第一个保存的人把配置"抢"走，之后所有人都在改他的配置。）
      const inserted = await this.db
        .insert(senderConfig)
        .values({
          senderName: patch.senderName ?? existing.senderName,
          senderTitle: patch.senderTitle ?? existing.senderTitle,
          personalStory: patch.personalStory ?? existing.personalStory,
        })
        .returning();
      return this.toResponse(inserted[0]);
    }

    const updated = await this.db
      .update(senderConfig)
      .set(patch)
      .where(eq(senderConfig.id, existing.id))
      .returning();

    return this.toResponse(updated[0]);
  }

  private toResponse(row: typeof senderConfig.$inferSelect): SenderConfig {
    return {
      id: row.id,
      senderName: row.senderName,
      senderTitle: row.senderTitle,
      personalStory: row.personalStory,
    };
  }
}