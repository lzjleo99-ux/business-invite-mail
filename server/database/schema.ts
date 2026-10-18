/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { boolean, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const appUsers = pgTable("app_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default('user'),
  isActive: boolean("is_active").notNull().default(true),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("app_users_email_key").on(table.email),
]);

export const emailThreads = pgTable("email_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  projectId: uuid("project_id").notNull(),
  threadDate: date("thread_date").notNull(),
  content: text("content").notNull(),
  direction: varchar("direction", { length: 20 }).notNull().default('outbound'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_email_threads_company_id").on(table.companyId),
  index("idx_email_threads_project_id").on(table.projectId),
  index("idx_email_threads_thread_date").on(table.threadDate),
]);

export const senderConfig = pgTable("sender_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  senderName: varchar("sender_name", { length: 255 }).notNull(),
  senderTitle: varchar("sender_title", { length: 255 }),
  personalStory: text("personal_story"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

export const projectMaterials = pgTable("project_materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileType: varchar("file_type", { length: 50 }).notNull(),
  fileSize: integer("file_size"),
  filePath: text("file_path"),
  contentSummary: text("content_summary"),
  parsedContent: text("parsed_content"),
  sortOrder: integer("sort_order").notNull().default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_project_materials_project_id").on(table.projectId),
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "project_materials_project_id_fkey",
  }).onDelete("cascade"),
]);

export const modelConfig = pgTable("model_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  apiBaseUrl: varchar("api_base_url", { length: 1000 }).notNull(),
  apiKey: varchar("api_key", { length: 1000 }).notNull(),
  modelName: varchar("model_name", { length: 255 }).notNull(),
  temperature: numeric("temperature"),
  emailLanguage: varchar("email_language", { length: 50 }).notNull().default('auto'),
  senderSignature: text("sender_signature").notNull(),
  importSecret: varchar("import_secret", { length: 255 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

export const projectImages = pgTable("project_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  imageFile: fileAttachment("image_file").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_project_images_project_id").on(table.projectId),
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "project_images_project_id_fkey",
  }).onDelete("cascade"),
]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 500 }).notNull(),
  description: text("description").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ownerId: uuid("owner_id"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_projects_owner_id").on(table.ownerId),
  foreignKey({
    columns: [table.ownerId],
    foreignColumns: [appUsers.id],
    name: "fk_projects_owner",
  }).onDelete("set null"),
]);

export const restaurants = pgTable("restaurants", {
  id: uuid("id").primaryKey().defaultRandom(),
  seqNo: integer("seq_no"),
  name: varchar("name", { length: 500 }).notNull(),
  country: varchar("country", { length: 255 }),
  address: text("address"),
  website: varchar("website", { length: 500 }),
  phone: varchar("phone", { length: 255 }),
  email: varchar("email", { length: 500 }),
  verifyStatus: varchar("verify_status", { length: 100 }),
  source: varchar("source", { length: 255 }),
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  status: varchar("status", { length: 50 }).notNull().default('pending'),
  websiteSummary: text("website_summary"),
  websiteLanguage: varchar("website_language", { length: 50 }),
  websiteCuisine: varchar("website_cuisine", { length: 255 }),
  websiteFeatures: text("website_features"),
  websiteContactEmail: varchar("website_contact_email", { length: 500 }),
  websiteContactPhone: varchar("website_contact_phone", { length: 255 }),
  websiteSocial: text("website_social"),
  websiteHours: text("website_hours"),
  analyzeError: text("analyze_error"),
  emailSubject: varchar("email_subject", { length: 1000 }),
  emailBody: text("email_body"),
  generateError: text("generate_error"),
  importBatchId: varchar("import_batch_id", { length: 100 }),
  projectId: uuid("project_id"),
  whatsappPhone: varchar("whatsapp_phone", { length: 255 }),
  whatsappMessage: text("whatsapp_message"),
  emailSubjectLocal: varchar("email_subject_local", { length: 1000 }),
  emailBodyLocal: text("email_body_local"),
  whatsappMessageLocal: text("whatsapp_message_local"),
  emailLanguage: varchar("email_language", { length: 10 }),
  isStarred: boolean("is_starred").notNull().default(false),
  /**
   * @type { whatsappContactedAt?: string; viberContactedAt?: string; emailContactedAt?: string; }
   */
  contactStatus: jsonb("contact_status").default('{}'),
  normalizedPhone: varchar("normalized_phone", { length: 50 }),
  phoneType: varchar("phone_type", { length: 20 }),
  normalizedWhatsappPhone: varchar("normalized_whatsapp_phone", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_restaurants_status").on(table.status),
  index("idx_restaurants_name").on(table.name),
  index("idx_restaurants_email").on(table.email),
  index("idx_restaurants_project_id").on(table.projectId),
  index("idx_restaurants_whatsapp_phone").on(table.whatsappPhone),
  index("idx_restaurants_is_starred").on(table.isStarred),
  index("idx_restaurants_normalized_phone").on(table.normalizedPhone),
  index("idx_restaurants_phone_type").on(table.phoneType),
]);

// table aliases
export const appUsersTable = appUsers;
export const emailThreadsTable = emailThreads;
export const passwordResetCodes = pgTable("password_reset_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull(),
  codeHash: varchar("code_hash", { length: 128 }).notNull(),
  expiresAt: customTimestamptz("expires_at", { precision: 3 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  usedAt: customTimestamptz("used_at", { precision: 3 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const smtpConfig = pgTable("smtp_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(465),
  secure: boolean("secure").notNull().default(true),
  username: varchar("username", { length: 255 }),
  password: varchar("password", { length: 255 }),
  fromName: varchar("from_name", { length: 255 }),
  fromEmail: varchar("from_email", { length: 255 }).notNull(),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * IMAP 收信配置（单行全局）。独立成表而非给 smtp_config 加列：
 * smtp_config 是平台迁移用户建的，应用用户 ALTER 报 must be owner
 * （与 project_materials 同一个坑）；CREATE 新表 owner 是自己。
 */
export const mailInboxSettings = pgTable("mail_inbox_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  imapHost: varchar("imap_host", { length: 255 }),
  imapPort: integer("imap_port").notNull().default(993),
  imapSecure: boolean("imap_secure").notNull().default(true),
  inboxPollEnabled: boolean("inbox_poll_enabled").notNull().default(false),
  inboxPollSeconds: integer("inbox_poll_seconds").notNull().default(180),
  inboxLastUid: integer("inbox_last_uid").notNull().default(0),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * 企业微信群机器人通知配置（单行全局）。
 * 客户回复被 IMAP 抓到时，往这个 webhook 推一条 markdown 提醒。
 * 自建表：平台管理的表不能 ALTER（见 mail_inbox_settings 注释）。
 * webhook 是敏感信息，只写不读（接口只回 webhookSet 布尔）。
 */
export const wecomNotifySettings = pgTable("wecom_notify_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  webhookUrl: text("webhook_url"),
  enabled: boolean("enabled").notNull().default(false),
  /** 收到回复时自动给该公司加星标 */
  autoStarOnReply: boolean("auto_star_on_reply").notNull().default(true),
  /** 提醒里是否带正文摘要（超长截断） */
  includeSnippet: boolean("include_snippet").notNull().default(true),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * 公司联系方式明细（一行一个联系方式）。
 * 站点上常常同时有总机、传真、多个分部电话、多个邮箱，单列
 * website_contact_email / website_contact_phone 只能存一个，需求是"多个都要列出来"。
 * 自建表：平台管理的表不能 ALTER（同 mail_inbox_settings / wecom_notify_settings）。
 * is_primary 标记表示"发信实际用的那个"（沿用邮箱排序打分选出的最优项）。
 */
export const companyContacts = pgTable("company_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => restaurants.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 10 }).notNull(), // email | phone
  value: varchar("value", { length: 320 }).notNull(),
  source: varchar("source", { length: 20 }).notNull().default('website'), // website | import | manual
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * 邮件往来历史（发信 + 收信全量留痕，后台真实数据）。
 * 自建表：平台管理的表不能 ALTER（project_materials 加列踩过 must be owner），
 * 独立新表 + FK cascade 是既定模式（material_blobs / material_image_descriptions 同款）。
 * message_id 唯一索引用于收信去重（同一封邮件只入库一次）。
 */
export const emailHistories = pgTable(
  "email_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => restaurants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    direction: varchar("direction", { length: 10 }).notNull(), // outbound | inbound
    status: varchar("status", { length: 20 }).notNull(), // sent | failed | received
    fromAddr: varchar("from_addr", { length: 320 }).notNull(),
    toAddr: varchar("to_addr", { length: 320 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    bodyHtml: text("body_html"),
    messageId: varchar("message_id", { length: 255 }),
    inReplyTo: varchar("in_reply_to", { length: 255 }),
    error: text("error"),
    sentAt: customTimestamptz("sent_at", { precision: 3 }),
    receivedAt: customTimestamptz("received_at", { precision: 3 }),
    createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    companyIdx: index("idx_email_histories_company").on(table.companyId, table.createdAt),
    projectIdx: index("idx_email_histories_project").on(table.projectId, table.createdAt),
    messageIdx: index("uq_email_histories_message").on(table.messageId),
  }),
);

// bytea ↔ Buffer 映射：postgres-js 直接给/收 Buffer
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// 素材文件字节。自建部署没有平台对象存储（FileService.upload 依赖
// /b/{appId}/get_published_v2 拿默认 bucket，自建环境该接口返回 SPA HTML），
// 文件字节落库；容器重建也不丢（跟业务表同库持久）。
// 与 project_materials 一一对应，行删除时级联清理。
export const materialBlobs = pgTable("material_blobs", {
  materialId: uuid("material_id")
    .primaryKey()
    .references(() => projectMaterials.id, { onDelete: "cascade" }),
  contentType: varchar("content_type", { length: 100 }).notNull().default("application/octet-stream"),
  data: bytea("data").notNull(),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// 图片素材的 AI 视觉描述（邮件选图用）。独立成表而非给 project_materials 加列：
// 平台管理的表归平台迁移用户所有，自建连接用户 ALTER 加列会报
// "must be owner of table"（CREATE 新表则 owner 是自己，material_blobs 已验证）。
// 与 project_materials 一一对应，行删除时级联清理。
export const materialImageDescriptions = pgTable("material_image_descriptions", {
  materialId: uuid("material_id")
    .primaryKey()
    .references(() => projectMaterials.id, { onDelete: "cascade" }),
  // 前缀 vision:/fallback: 标记描述来源（读取时剥掉）
  description: text("description").notNull(),
  source: varchar("source", { length: 20 }).notNull().default("fallback"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const modelConfigTable = modelConfig;
export const projectImagesTable = projectImages;
export const projectMaterialsTable = projectMaterials;
export const projectsTable = projects;
export const restaurantsTable = restaurants;
export const senderConfigTable = senderConfig;
