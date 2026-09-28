/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { boolean, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, uuid, varchar, customType } from "drizzle-orm/pg-core"

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
export const emailThreadsTable = emailThreads;
export const modelConfigTable = modelConfig;
export const projectImagesTable = projectImages;
export const projectMaterialsTable = projectMaterials;
export const projectsTable = projects;
export const restaurantsTable = restaurants;
export const senderConfigTable = senderConfig;
