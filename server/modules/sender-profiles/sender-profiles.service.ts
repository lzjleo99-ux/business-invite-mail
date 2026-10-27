import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';

/**
 * 发信人档案（多身份）：一个用户可以有多个发信人身份，每个身份包含
 * 姓名/职位/公司/富签名（可含图片）。发送时选择用哪个身份。
 *
 * 参考 Finbuckle.MultiTenant 的思路：数据按 owner_id 隔离，读取一律限定
 * 当前用户；自建表（运行时身份建表即拥有），请求路径幂等建表。
 *
 * 签名里的图片存 sender_profile_images（bytea），通过 /images/:id 公开读取
 * （收件人的邮件客户端不带登录态，URL 靠 uuid 不可枚举保证安全）。
 * 发送时按 URL 找回字节，以 CID 内嵌进邮件。
 */

export interface SenderProfile {
  id: string;
  profileName: string;
  senderName: string;
  senderTitle: string | null;
  companyName: string | null;
  signatureHtml: string;
  isDefault: boolean;
  createdAt: string;
}

export interface SenderProfileInput {
  profileName: string;
  senderName: string;
  senderTitle?: string | null;
  companyName?: string | null;
  signatureHtml?: string | null;
  isDefault?: boolean;
}

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS sender_profiles (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       text NOT NULL,
    profile_name   varchar(255) NOT NULL,
    sender_name    varchar(255) NOT NULL,
    sender_title   varchar(255),
    company_name   varchar(255),
    signature_html text NOT NULL DEFAULT '',
    is_default     boolean NOT NULL DEFAULT false,
    _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

@Injectable()
export class SenderProfilesService {
  private readonly logger = new Logger(SenderProfilesService.name);
  private ensurePromise?: Promise<void>;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  ensureTable(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = runIdempotentMigration(
        this.db,
        'sender_profiles 建表迁移',
        async (run) => {
          await run(TABLE_DDL);
          await run(`CREATE TABLE IF NOT EXISTS sender_profile_images (
            id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_id   text NOT NULL,
            filename   varchar(255) NOT NULL DEFAULT 'image',
            mime       varchar(100) NOT NULL DEFAULT 'image/png',
            bytes      bytea NOT NULL,
            _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`);
          try {
            await run(
              'GRANT ALL PRIVILEGES ON TABLE sender_profiles TO anon_, authenticated_, service_role_',
            );
            await run(
              'GRANT ALL PRIVILEGES ON TABLE sender_profile_images TO anon_, authenticated_, service_role_',
            );
          } catch (err: unknown) {
            this.logger.warn(
              `sender_profiles 授权失败（可忽略于非自建环境）: ${String(err).split('\n')[0]}`,
            );
          }
        },
      )
        .then(() => undefined)
        .catch((err: unknown) => {
          this.ensurePromise = undefined;
          throw err;
        });
    }
    return this.ensurePromise;
  }

  async list(userId: string): Promise<SenderProfile[]> {
    await this.ensureTable();
    const rows = await this.db
      .select()
      .from(senderProfilesTable)
      .where(eq(senderProfilesTable.ownerId, userId))
      .orderBy(sql`is_default desc, _created_at asc`);
    return rows.map((r) => this.toResponse(r));
  }

  async create(userId: string, input: SenderProfileInput): Promise<SenderProfile> {
    await this.ensureTable();
    if (!input.profileName?.trim() || !input.senderName?.trim()) {
      throw new BadRequestException('档案名和发信人姓名不能为空');
    }
    // 第一个档案自动设为默认
    const existing = await this.list(userId);
    const isDefault = input.isDefault ?? existing.length === 0;
    if (isDefault) await this.clearDefault(userId);
    const inserted = await this.db
      .insert(senderProfilesTable)
      .values({
        ownerId: userId,
        profileName: input.profileName.trim().slice(0, 255),
        senderName: input.senderName.trim().slice(0, 255),
        senderTitle: input.senderTitle?.trim() || null,
        companyName: input.companyName?.trim() || null,
        signatureHtml: input.signatureHtml ?? '',
        isDefault,
      })
      .returning();
    return this.toResponse(inserted[0]);
  }

  async update(userId: string, id: string, input: Partial<SenderProfileInput>): Promise<SenderProfile> {
    await this.ensureTable();
    const patch: Record<string, unknown> = {};
    if (input.profileName !== undefined) patch.profileName = input.profileName.trim().slice(0, 255);
    if (input.senderName !== undefined) patch.senderName = input.senderName.trim().slice(0, 255);
    if (input.senderTitle !== undefined) patch.senderTitle = input.senderTitle?.trim() || null;
    if (input.companyName !== undefined) patch.companyName = input.companyName?.trim() || null;
    if (input.signatureHtml !== undefined) patch.signatureHtml = input.signatureHtml;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('没有要更新的字段');
    }
    patch.updatedAt = new Date();
    const updated = await this.db
      .update(senderProfilesTable)
      .set(patch)
      .where(and(eq(senderProfilesTable.id, id), eq(senderProfilesTable.ownerId, userId)))
      .returning();
    if (updated.length === 0) throw new NotFoundException('档案不存在或无权访问');
    return this.toResponse(updated[0]);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.ensureTable();
    const deleted = await this.db
      .delete(senderProfilesTable)
      .where(and(eq(senderProfilesTable.id, id), eq(senderProfilesTable.ownerId, userId)))
      .returning({ id: senderProfilesTable.id });
    if (deleted.length === 0) throw new NotFoundException('档案不存在或无权访问');
  }

  async setDefault(userId: string, id: string): Promise<SenderProfile> {
    await this.ensureTable();
    await this.clearDefault(userId);
    const updated = await this.db
      .update(senderProfilesTable)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(senderProfilesTable.id, id), eq(senderProfilesTable.ownerId, userId)))
      .returning();
    if (updated.length === 0) throw new NotFoundException('档案不存在或无权访问');
    return this.toResponse(updated[0]);
  }

  /** 发送时取档案：指定 id 或用户默认；都没有返回 null（回退旧 sender_config） */
  async resolveForSend(userId: string, profileId?: string | null): Promise<SenderProfile | null> {
    await this.ensureTable();
    if (profileId) {
      const rows = await this.db
        .select()
        .from(senderProfilesTable)
        .where(and(eq(senderProfilesTable.id, profileId), eq(senderProfilesTable.ownerId, userId)))
        .limit(1);
      if (rows[0]) return this.toResponse(rows[0]);
      throw new BadRequestException('发信人档案不存在或无权访问');
    }
    const def = await this.db
      .select()
      .from(senderProfilesTable)
      .where(and(eq(senderProfilesTable.ownerId, userId), eq(senderProfilesTable.isDefault, true)))
      .limit(1);
    if (def[0]) return this.toResponse(def[0]);
    const any = await this.db
      .select()
      .from(senderProfilesTable)
      .where(eq(senderProfilesTable.ownerId, userId))
      .orderBy(asc(senderProfilesTable.createdAt))
      .limit(1);
    return any[0] ? this.toResponse(any[0]) : null;
  }

  /** 签名 HTML 里引用的档案图片 id 列表（发信时转 CID 用） */
  extractImageIds(signatureHtml: string): string[] {
    const ids: string[] = [];
    for (const m of String(signatureHtml || '').matchAll(
      /\/api\/sender-profiles\/images\/([0-9a-f-]{36})/g,
    )) {
      if (!ids.includes(m[1])) ids.push(m[1]);
    }
    return ids;
  }

  async getImageBytes(
    userId: string | null,
    imageId: string,
  ): Promise<{ filename: string; mime: string; bytes: Buffer } | null> {
    await this.ensureTable();
    const rows = await this.db
      .select()
      .from(senderProfileImagesTable)
      .where(eq(senderProfileImagesTable.id, imageId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    // 公开端点只受 uuid 不可枚举保护；属主校验仅在需要时（如删除）使用
    void userId;
    return { filename: r.filename, mime: r.mime, bytes: r.bytes };
  }

  async saveImage(
    userId: string,
    filename: string,
    mime: string,
    bytes: Buffer,
  ): Promise<{ id: string; url: string }> {
    await this.ensureTable();
    const inserted = await this.db
      .insert(senderProfileImagesTable)
      .values({
        ownerId: userId,
        filename: filename.slice(0, 255),
        mime: (mime || 'image/png').slice(0, 100),
        bytes,
      })
      .returning({ id: senderProfileImagesTable.id });
    return { id: inserted[0].id, url: `/openapi/sender-profiles/images/${inserted[0].id}` };
  }

  private async clearDefault(userId: string): Promise<void> {
    await this.db
      .update(senderProfilesTable)
      .set({ isDefault: false })
      .where(eq(senderProfilesTable.ownerId, userId));
  }

  private toResponse(r: typeof senderProfilesTable.$inferSelect): SenderProfile {
    return {
      id: r.id,
      profileName: r.profileName,
      senderName: r.senderName,
      senderTitle: r.senderTitle,
      companyName: r.companyName,
      signatureHtml: r.signatureHtml,
      isDefault: r.isDefault,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

// 表定义直接引 schema（避免循环依赖）：表在 sender-profiles.schema 里声明
import {
  senderProfilesTable,
  senderProfileImagesTable,
} from '@server/database/schema';
