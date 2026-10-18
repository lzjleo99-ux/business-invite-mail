-- business-invite-mail 全栈部署建表脚本
-- 来源：server/database/schema.ts（drizzle 生成，勿手改 schema 后不同步本文件）
-- 适用：PostgreSQL 13+（gen_random_uuid() 内置）。平台部署时表结构由平台管理，
--       本脚本用于自建 Postgres（本地验证 / VPS 部署）。
--
-- 用法：  psql "$SUDA_DATABASE_URL" -f scripts/schema.sql


-- ---------- 平台自定义复合类型 ----------
-- user_profile：平台"用户"复合类型，业务代码只写/读第一个字段（user_id）
CREATE TYPE user_profile AS (user_id text);
-- file_attachment：平台"文件附件"复合类型
CREATE TYPE file_attachment AS (bucket_id text, file_path text);

-- ---------- app_users（账号） ----------
CREATE TABLE IF NOT EXISTS app_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          varchar(255) NOT NULL,
  password_hash  varchar(255) NOT NULL,
  display_name   varchar(255) NOT NULL,
  role           varchar(20)  NOT NULL DEFAULT 'user',
  is_active      boolean      NOT NULL DEFAULT true,
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_key ON app_users (email);

-- ---------- projects（项目资料） ----------
CREATE TABLE IF NOT EXISTS projects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           varchar(500) NOT NULL,
  description    text NOT NULL,
  sort_order     integer NOT NULL DEFAULT 0,
  owner_id       uuid,
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END),
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END)
);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects (owner_id);
DO $$ BEGIN
  ALTER TABLE projects
    ADD CONSTRAINT fk_projects_owner FOREIGN KEY (owner_id)
    REFERENCES app_users (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- restaurants（餐厅名录） ----------
CREATE TABLE IF NOT EXISTS restaurants (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq_no                   integer,
  name                     varchar(500) NOT NULL,
  country                  varchar(255),
  address                  text,
  website                  varchar(500),
  phone                    varchar(255),
  email                    varchar(500),
  verify_status            varchar(100),
  source                   varchar(255),
  latitude                 numeric,
  longitude                numeric,
  status                   varchar(50) NOT NULL DEFAULT 'pending',
  website_summary          text,
  website_language         varchar(50),
  website_cuisine          varchar(255),
  website_features         text,
  website_contact_email    varchar(500),
  website_contact_phone    varchar(255),
  website_social           text,
  website_hours            text,
  analyze_error            text,
  email_subject            varchar(1000),
  email_body               text,
  generate_error           text,
  import_batch_id          varchar(100),
  project_id               uuid,
  whatsapp_phone           varchar(255),
  whatsapp_message         text,
  email_subject_local      varchar(1000),
  email_body_local         text,
  whatsapp_message_local   text,
  email_language           varchar(10),
  is_starred               boolean NOT NULL DEFAULT false,
  contact_status           jsonb DEFAULT '{}',
  normalized_phone         varchar(50),
  phone_type               varchar(20),
  normalized_whatsapp_phone varchar(50),
  _created_at              timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by              user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END),
  _updated_at              timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by              user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END)
);
CREATE INDEX IF NOT EXISTS idx_restaurants_status ON restaurants (status);
CREATE INDEX IF NOT EXISTS idx_restaurants_name ON restaurants (name);
CREATE INDEX IF NOT EXISTS idx_restaurants_email ON restaurants (email);
CREATE INDEX IF NOT EXISTS idx_restaurants_project_id ON restaurants (project_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_whatsapp_phone ON restaurants (whatsapp_phone);
CREATE INDEX IF NOT EXISTS idx_restaurants_is_starred ON restaurants (is_starred);
CREATE INDEX IF NOT EXISTS idx_restaurants_normalized_phone ON restaurants (normalized_phone);
CREATE INDEX IF NOT EXISTS idx_restaurants_phone_type ON restaurants (phone_type);

-- ---------- sender_config（发件人配置） ----------
CREATE TABLE IF NOT EXISTS sender_config (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_name    varchar(255) NOT NULL,
  sender_title   varchar(255),
  personal_story text,
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END),
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END)
);

-- ---------- model_config（模型配置 + 导入密钥，单行） ----------
CREATE TABLE IF NOT EXISTS model_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_base_url     varchar(1000) NOT NULL,
  api_key          varchar(1000) NOT NULL,
  model_name       varchar(255) NOT NULL,
  temperature      numeric,
  email_language   varchar(50) NOT NULL DEFAULT 'auto',
  sender_signature text NOT NULL,
  import_secret    varchar(255),
  _created_at      timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by      user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END),
  _updated_at      timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by      user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END)
);

-- ---------- project_materials（项目资料文件） ----------
CREATE TABLE IF NOT EXISTS project_materials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL,
  file_name        varchar(500) NOT NULL,
  file_type        varchar(50) NOT NULL,
  file_size        integer,
  file_path        text,
  content_summary  text,
  parsed_content   text,
  sort_order       integer NOT NULL DEFAULT 0,
  _created_at      timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by      user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END),
  _updated_at      timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by      user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END)
);
CREATE INDEX IF NOT EXISTS idx_project_materials_project_id ON project_materials (project_id);
DO $$ BEGIN
  ALTER TABLE project_materials
    ADD CONSTRAINT project_materials_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES projects (id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- project_images（项目图片） ----------
CREATE TABLE IF NOT EXISTS project_images (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL,
  image_file     file_attachment NOT NULL,
  sort_order     integer NOT NULL DEFAULT 0,
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END),
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END)
);
CREATE INDEX IF NOT EXISTS idx_project_images_project_id ON project_images (project_id);
DO $$ BEGIN
  ALTER TABLE project_images
    ADD CONSTRAINT project_images_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES projects (id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- email_threads（邮件会话） ----------
CREATE TABLE IF NOT EXISTS email_threads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  project_id     uuid NOT NULL,
  thread_date    date NOT NULL,
  content        text NOT NULL,
  direction      varchar(20) NOT NULL DEFAULT 'outbound',
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END),
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile DEFAULT (CASE WHEN current_setting('app.user_id', true) = '' THEN NULL::user_profile END)
);
CREATE INDEX IF NOT EXISTS idx_email_threads_company_id ON email_threads (company_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_project_id ON email_threads (project_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_thread_date ON email_threads (thread_date);


-- ---------- password_reset_codes（找回密码验证码） ----------
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        varchar(255) NOT NULL,
  code_hash    varchar(128) NOT NULL,
  expires_at   timestamptz(3) NOT NULL,
  attempts     integer      NOT NULL DEFAULT 0,
  used_at      timestamptz(3),
  _created_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_email ON password_reset_codes (email);
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_expires ON password_reset_codes (expires_at);

-- ---------- smtp_config（发信服务配置，全局单行，密码只写） ----------
CREATE TABLE IF NOT EXISTS smtp_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host         varchar(255) NOT NULL,
  port         integer      NOT NULL DEFAULT 465,
  secure       boolean      NOT NULL DEFAULT true,
  username     varchar(255),
  password     varchar(255),
  from_name    varchar(255),
  from_email   varchar(255) NOT NULL,
  _created_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------- material_blobs（素材文件字节，自建部署无平台对象存储，落库持久） ----------
-- 与 project_materials 一一对应；行删除时级联清理。授权给平台三角色见下。
CREATE TABLE IF NOT EXISTS material_blobs (
  material_id   uuid PRIMARY KEY REFERENCES project_materials(id) ON DELETE CASCADE,
  content_type  varchar(100) NOT NULL DEFAULT 'application/octet-stream',
  data          bytea NOT NULL,
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 平台中间件按请求 SET LOCAL ROLE（anon_/authenticated_/service_role_），
-- 新表必须显式授权，否则运行时 DML 报 permission denied（幂等）。
GRANT ALL PRIVILEGES ON TABLE material_blobs TO anon_, authenticated_, service_role_;

-- ---------- 图片素材的 AI 视觉描述（邮件选图用） ----------
-- 独立成表而非给 project_materials 加列：平台表归平台迁移用户所有，
-- ALTER 加列报 must be owner；CREATE 新表 owner 是自己（幂等）。
CREATE TABLE IF NOT EXISTS material_image_descriptions (
  material_id   uuid PRIMARY KEY REFERENCES project_materials(id) ON DELETE CASCADE,
  description   text NOT NULL,
  source        varchar(20) NOT NULL DEFAULT 'fallback',
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
GRANT ALL PRIVILEGES ON TABLE material_image_descriptions TO anon_, authenticated_, service_role_;

-- ---------- 邮件往来历史（发信+收信全量留痕） ----------
-- 自建表（平台表不可 ALTER，独立新表 + FK cascade）；message_id 唯一索引用于收信去重
CREATE TABLE IF NOT EXISTS email_histories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES restaurants(id) ON DELETE CASCADE,
  project_id     uuid,
  direction      varchar(10) NOT NULL,
  status         varchar(20) NOT NULL,
  from_addr      varchar(320) NOT NULL,
  to_addr        varchar(320) NOT NULL,
  subject        varchar(500) NOT NULL DEFAULT '',
  body_text      text NOT NULL DEFAULT '',
  body_html      text,
  message_id     varchar(255),
  in_reply_to    varchar(255),
  error          text,
  sent_at        timestamptz(3),
  received_at    timestamptz(3),
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_histories_company ON email_histories (company_id, _created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_histories_project ON email_histories (project_id, _created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_histories_message ON email_histories (message_id);
GRANT ALL PRIVILEGES ON TABLE email_histories TO anon_, authenticated_, service_role_;

-- ---------- smtp_config 收信（IMAP）配置列 ----------
ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS imap_host varchar(255);
ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS imap_port integer NOT NULL DEFAULT 993;
ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS imap_secure boolean NOT NULL DEFAULT true;
ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS inbox_poll_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS inbox_poll_seconds integer NOT NULL DEFAULT 180;
ALTER TABLE smtp_config ADD COLUMN IF NOT EXISTS inbox_last_uid integer NOT NULL DEFAULT 0;
