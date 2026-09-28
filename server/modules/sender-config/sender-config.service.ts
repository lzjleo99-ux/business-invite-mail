import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
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

  async getConfig(): Promise<SenderConfig> {
    const rows = await this.db.select().from(senderConfig).limit(1);

    if (rows.length > 0) {
      return this.toResponse(rows[0]);
    }

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

  async updateConfig(data: UpdateSenderConfigRequest): Promise<SenderConfig> {
    const existing = await this.getConfig();

    const patch: Partial<typeof senderConfig.$inferInsert> = {};
    if (data.senderName !== undefined) patch.senderName = data.senderName;
    if (data.senderTitle !== undefined) patch.senderTitle = data.senderTitle;
    if (data.personalStory !== undefined) patch.personalStory = data.personalStory;

    if (Object.keys(patch).length === 0) {
      return existing;
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
