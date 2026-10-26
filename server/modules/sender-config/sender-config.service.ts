import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
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

/**
 * 发件人身份（姓名/职位/背景故事）——GitHub 资料式隔离。
 *
 * 每个用户一行**私有档案**：读取只碰自己的行，保存只改自己的行，
 * 任何人的修改都不影响其他人，也不会"自动恢复"成别人的信息。
 *
 * ── 为什么 2026-10-26 之前会互相覆盖（bug 复盘）──
 * 旧实现读的时候 `OR _created_by IS NULL`（全局行兜底）、写的时候
 * **依赖平台自动填 _created_by**。但本自建部署上请求事务里不会稳定设置
 * app.user_id，默认值 `CASE WHEN ... = '' THEN NULL` 落空 → 同事保存时
 * 插入的行 _created_by 是 NULL，成了"又一条全局行"。之后任何人读取，
 * 多条全局行之间 `ORDER BY is null asc LIMIT 1` 命中谁全看运气——
 * 表现就是"同事改完，系统又自动恢复成 zijian 的信息"。
 *
 * ── 修复后的隔离方案 ──
 * 1. 读取：只查 `(_created_by).user_id = 当前用户`，绝不回退全局行；
 * 2. 首次访问：播种一份私有档案——内容优先从 bug 期间落成 NULL、且
 *    sender_name 与用户显示名一致的行找回（恢复同事当时填的数据），
 *    找不到再用最新的全局行/默认值；
 * 3. 写入：手动 `ROW(uid)` 写 _created_by（与 model_config 0bbcc27 同款，
 *    已验证可靠），UPDATE 只按自己的行 id；
 * 4. 旧全局行（_created_by IS NULL）保留在库里只作播种来源，永远不再被
 *    登录用户读到。
 *
 * 三个字段（姓名/职位/背景故事）是**同一个人身份的三个属性**，保持在
 * 同一行里——这正是 GitHub 的模型：一个用户一份资料，资料里有多个字段。
 * 隔离的单位是"用户"，不是"字段"。
 */

/** 拿到该用户自己的发件人档案行；没有就播种（私有、带属主）。 */
export async function ensureOwnSenderRow(
  db: PostgresJsDatabase,
  userId: string,
  displayName?: string,
): Promise<typeof senderConfig.$inferSelect> {
  // 1) 自己的行（多条时取最早的——播种竞态下保留第一份）
  const own = await db
    .select()
    .from(senderConfig)
    .where(sql`(${senderConfig.createdBy}).user_id = ${userId}`)
    .orderBy(asc(senderConfig.createdAt))
    .limit(1);
  if (own[0]) return own[0];

  // 2) 播种内容的来源：
  //    a. bug 期间落成 NULL、且 sender_name 与该用户显示名一致的行（找回他的数据）
  //    b. 否则最新的全局行（原作者的配置，作为起点）
  let src: typeof senderConfig.$inferSelect | undefined;
  if (displayName && displayName.trim()) {
    const recovered = await db
      .select()
      .from(senderConfig)
      .where(
        and(
          isNull(senderConfig.createdBy),
          ilike(senderConfig.senderName, displayName.trim()),
        ),
      )
      .orderBy(desc(senderConfig.createdAt))
      .limit(1);
    if (recovered[0]) src = recovered[0];
  }
  if (!src) {
    const legacy = await db
      .select()
      .from(senderConfig)
      .where(isNull(senderConfig.createdBy))
      .orderBy(desc(senderConfig.createdAt))
      .limit(1);
    src = legacy[0];
  }

  // 3) 插入私有行：_created_by 必须手写 ROW(uid)——平台自动填在此部署不可靠
  const inserted = await db
    .insert(senderConfig)
    .values({
      senderName: src?.senderName ?? DEFAULT_SENDER_NAME,
      senderTitle: src?.senderTitle ?? DEFAULT_SENDER_TITLE,
      personalStory: src?.personalStory ?? DEFAULT_PERSONAL_STORY,
      createdBy: sql`ROW(${userId}::text)`,
    })
    .returning();
  return inserted[0];
}

@Injectable()
export class SenderConfigService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getConfig(
    userId?: string,
    displayName?: string,
  ): Promise<SenderConfig> {
    if (!userId) {
      // 无登录上下文（旧调用路径）：读最新全局行，没有给默认值
      const rows = await this.db
        .select()
        .from(senderConfig)
        .where(isNull(senderConfig.createdBy))
        .orderBy(desc(senderConfig.createdAt))
        .limit(1);
      if (rows[0]) return this.toResponse(rows[0]);
      return {
        id: '',
        senderName: DEFAULT_SENDER_NAME,
        senderTitle: DEFAULT_SENDER_TITLE,
        personalStory: DEFAULT_PERSONAL_STORY,
      };
    }
    const row = await ensureOwnSenderRow(this.db, userId, displayName);
    return this.toResponse(row);
  }

  async updateConfig(
    data: UpdateSenderConfigRequest,
    userId?: string,
    displayName?: string,
  ): Promise<SenderConfig> {
    if (!userId) {
      // 无登录上下文：改最新全局行（历史行为，理论上不会再走到）
      const rows = await this.db
        .select()
        .from(senderConfig)
        .where(isNull(senderConfig.createdBy))
        .orderBy(desc(senderConfig.createdAt))
        .limit(1);
      const target = rows[0];
      if (!target) {
        const seeded = await ensureOwnSenderRow(this.db, 'legacy');
        return this.toResponse(seeded);
      }
      const patch = this.buildPatch(data);
      if (Object.keys(patch).length === 0) return this.toResponse(target);
      const updated = await this.db
        .update(senderConfig)
        .set(patch)
        .where(eq(senderConfig.id, target.id))
        .returning();
      return this.toResponse(updated[0]);
    }

    // 登录用户：只改自己的私有档案行
    const own = await ensureOwnSenderRow(this.db, userId, displayName);
    const patch = this.buildPatch(data);
    if (Object.keys(patch).length === 0) return this.toResponse(own);

    const updated = await this.db
      .update(senderConfig)
      .set(patch)
      .where(eq(senderConfig.id, own.id))
      .returning();
    return this.toResponse(updated[0]);
  }

  private buildPatch(
    data: UpdateSenderConfigRequest,
  ): Partial<typeof senderConfig.$inferInsert> {
    const patch: Partial<typeof senderConfig.$inferInsert> = {};
    if (data.senderName !== undefined) patch.senderName = data.senderName;
    if (data.senderTitle !== undefined) patch.senderTitle = data.senderTitle;
    if (data.personalStory !== undefined) patch.personalStory = data.personalStory;
    return patch;
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
