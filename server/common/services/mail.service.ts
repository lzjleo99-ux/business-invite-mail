import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, desc, eq, sql, and, or, isNull } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import { smtpConfig, mailInboxSettings, smtpAccounts } from '@server/database/schema';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';

/** SMTP 基础列（不含 IMAP 列）——IMAP 列是后加的，读取必须容忍「列还没建」 */
type SmtpBaseRow = Pick<
  typeof smtpConfig.$inferSelect,
  'id' | 'host' | 'port' | 'secure' | 'username' | 'password' | 'fromName' | 'fromEmail'
>;

export interface ImapSettings {
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  inboxPollEnabled: boolean;
  inboxPollSeconds: number;
  inboxLastUid: number;
}

const IMAP_DEFAULTS: ImapSettings = {
  imapHost: null,
  imapPort: 993,
  imapSecure: true,
  inboxPollEnabled: false,
  inboxPollSeconds: 180,
  inboxLastUid: 0,
};

/** 全局单行的 SMTP 配置（只写密码：对外只暴露 passwordSet 布尔） */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private transporterKey = '';
  private inboxTablePromise: Promise<void> | null = null;
  private accountsTablePromise: Promise<void> | null = null;
  private ownerColumnPromise: Promise<void> | null = null;
  private inboxOwnerColumnPromise: Promise<void> | null = null;

  /**
   * 收件箱 IMAP 配置改为每用户一份：给 mail_inbox_settings 加 owner_id（幂等）。
   * 表是自建的，owner 是自己，可以 ALTER。读/写都按 userId 过滤，
   * 老行 owner_id IS NULL 作为全局回退，保证升级不破坏现有收信。
   */
  private async ensureInboxOwnerColumn(): Promise<void> {
    if (!this.inboxOwnerColumnPromise) {
      this.inboxOwnerColumnPromise = runIdempotentMigration(
        this.db,
        'mail_inbox_settings_owner_id',
        async (run) => {
          await run('ALTER TABLE mail_inbox_settings ADD COLUMN IF NOT EXISTS owner_id varchar(64)');
          await run('CREATE INDEX IF NOT EXISTS idx_mail_inbox_owner ON mail_inbox_settings (owner_id)');
        },
      )
        .then(() => undefined)
        .catch((err: unknown) => {
          this.inboxOwnerColumnPromise = null;
          throw err;
        });
    }
    return this.inboxOwnerColumnPromise;
  }
  /** 每个账号一个 transport，key = id:password 前几位，避免串号 */
  private accountTransporters = new Map<string, { key: string; transporter: Transporter }>();

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * 只 select 基础列：IMAP 列由 ensureImapColumns() 后加创建，
   * 全量 select 在列缺失时会直接 500（读设置是启动路径也会走的）。
   */
  /**
   * 取发信配置：优先当前用户自己那份，取不到再回退旧的全局行（owner_id IS NULL）。
   * 这样升级后老配置仍然可用，且每个用户可以配自己的 SMTP。
   */
  async getSettings(userId?: string): Promise<SmtpBaseRow | null> {
    await this.ensureOwnerColumn();
    // 1) 自己的 SMTP（在自建的 smtp_accounts 里，优先默认账号）
    if (userId) {
      // 包 try/catch：owner_id 迁移若因权限/时序没跑完，就当"这个人还没配过"，
      // 绝不能因此把整个发信服务页打成 500。
      let row: typeof smtpAccounts.$inferSelect | undefined;
      try {
        // 用 drizzle 查询构建器而不是裸 SQL：和 listAccounts 走同一条已验证路径，
        // 避免 execute(sql\`...\`) 的参数/返回值形态差异导致静默取不到。
        const own = await this.db
          .select()
          .from(smtpAccounts)
          .where(eq(smtpAccounts.ownerId, userId))
          .orderBy(desc(smtpAccounts.isDefault), asc(smtpAccounts.createdAt))
          .limit(1);
        row = own[0];
      } catch (err: unknown) {
        this.logger.warn(
          `读取用户 SMTP 账号失败，回退全局配置：${err instanceof Error ? err.message : String(err)}`,
        );
        row = undefined;
      }
      if (row) {
        return {
          id: row.id,
          host: row.host,
          port: row.port,
          secure: row.secure,
          username: row.email,
          password: row.password,
          fromName: row.fromName,
          fromEmail: row.email,
        };
      }
    }

    // 2) 回退：旧的全局单行（smtp_config）
    const rows = await this.db
      .select({
        id: smtpConfig.id,
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        username: smtpConfig.username,
        password: smtpConfig.password,
        fromName: smtpConfig.fromName,
        fromEmail: smtpConfig.fromEmail,
      })
      .from(smtpConfig)
      .orderBy(desc(smtpConfig.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async isConfigured(userId?: string): Promise<boolean> {
    const s = await this.getSettings(userId);
    return !!s && !!s.host && !!s.fromEmail;
  }

  /**
   * IMAP 收信配置存放在**自建表** mail_inbox_settings（单行全局）：
   * smtp_config 是平台迁移用户建的，应用用户 ALTER 会报 must be owner
   * （project_materials 加列踩过同一个坑）——所以不能给它加列。
   * 建表只在写/轮询路径做（请求期 DDL 已验证可行）；读不到就返回默认值。
   */
  async ensureInboxTable(): Promise<void> {
    if (!this.inboxTablePromise) {
      this.inboxTablePromise = runIdempotentMigration(
        this.db,
        'mail_inbox_settings 建表迁移',
        async (run) => {
          await run(`
            CREATE TABLE IF NOT EXISTS mail_inbox_settings (
              id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              imap_host            varchar(255),
              imap_port            integer NOT NULL DEFAULT 993,
              imap_secure          boolean NOT NULL DEFAULT true,
              inbox_poll_enabled   boolean NOT NULL DEFAULT false,
              inbox_poll_seconds   integer NOT NULL DEFAULT 180,
              inbox_last_uid       integer NOT NULL DEFAULT 0,
              _created_at          timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              _updated_at          timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `);
          try {
            await run('GRANT ALL PRIVILEGES ON TABLE mail_inbox_settings TO anon_, authenticated_, service_role_');
          } catch (err) {
            this.logger.warn(`mail_inbox_settings 授权失败（可忽略于非自建环境）: ${String(err).split('\n')[0]}`);
          }
        },
      )
        .then((via) => {
          this.logger.log(`mail_inbox_settings 表已就绪（via ${via}）`);
        })
        .catch((err) => {
          this.inboxTablePromise = null;
          throw err;
        });
    }
    return this.inboxTablePromise;
  }

  /** IMAP 收信配置读取：表/行不存在时返回默认值（未开启），绝不抛错 */
  /**
   * 收件配置：**跟着邮箱走**——取该用户默认发信账号上的 IMAP 字段。
   * 用户还没有账号时才回退旧的全局 mail_inbox_settings（升级兼容）。
   */
  async getImapSettings(userId?: string): Promise<ImapSettings> {
    if (userId) {
      try {
        await this.ensureAccountsTable();
        const rows = await this.db
          .select({
            imapHost: smtpAccounts.imapHost,
            imapPort: smtpAccounts.imapPort,
            imapSecure: smtpAccounts.imapSecure,
            inboxPollEnabled: smtpAccounts.inboxPollEnabled,
            inboxPollSeconds: smtpAccounts.inboxPollSeconds,
            inboxLastUid: smtpAccounts.inboxLastUid,
          })
          .from(smtpAccounts)
          .where(eq(smtpAccounts.ownerId, userId))
          .orderBy(desc(smtpAccounts.isDefault), asc(smtpAccounts.createdAt))
          .limit(1);
        const row = rows[0];
        if (row) {
          return {
            imapHost: row.imapHost,
            imapPort: row.imapPort || 993,
            imapSecure: row.imapSecure !== false,
            inboxPollEnabled: row.inboxPollEnabled,
            inboxPollSeconds: row.inboxPollSeconds || 180,
            inboxLastUid: row.inboxLastUid || 0,
          };
        }
      } catch (err: unknown) {
        this.logger.warn(
          `读取用户 IMAP 配置失败，回退全局：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    try {
      await this.ensureInboxOwnerColumn();
      const result = (await this.db.execute(sql`
        SELECT imap_host AS "imapHost",
               imap_port AS "imapPort",
               imap_secure AS "imapSecure",
               inbox_poll_enabled AS "inboxPollEnabled",
               inbox_poll_seconds AS "inboxPollSeconds",
               inbox_last_uid AS "inboxLastUid"
        FROM mail_inbox_settings
        WHERE owner_id IS NULL OR owner_id = ${userId ?? ''}
        ORDER BY (owner_id IS NULL) ASC, _created_at ASC
        LIMIT 1
      `)) as unknown as Array<Record<string, unknown>>;
      const row = result[0];
      if (!row) return IMAP_DEFAULTS;
      return {
        imapHost: typeof row.imapHost === 'string' ? row.imapHost : null,
        imapPort: Number(row.imapPort) || 993,
        imapSecure: row.imapSecure !== false,
        inboxPollEnabled: !!row.inboxPollEnabled,
        inboxPollSeconds: Number(row.inboxPollSeconds) || 180,
        inboxLastUid: Number(row.inboxLastUid) || 0,
      };
    } catch {
      // 表还没建（未跑过 ensureInboxTable）→ 视为未配置
      return IMAP_DEFAULTS;
    }
  }

  /** 读**指定账号**的收件配置（多邮箱各自轮询用） */
  async getImapSettingsForAccount(accountId: string): Promise<ImapSettings | null> {
    await this.ensureAccountsTable();
    const rows = await this.db
      .select({
        imapHost: smtpAccounts.imapHost,
        imapPort: smtpAccounts.imapPort,
        imapSecure: smtpAccounts.imapSecure,
        inboxPollEnabled: smtpAccounts.inboxPollEnabled,
        inboxPollSeconds: smtpAccounts.inboxPollSeconds,
        inboxLastUid: smtpAccounts.inboxLastUid,
      })
      .from(smtpAccounts)
      .where(eq(smtpAccounts.id, accountId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      imapHost: row.imapHost,
      imapPort: row.imapPort || 993,
      imapSecure: row.imapSecure !== false,
      inboxPollEnabled: row.inboxPollEnabled,
      inboxPollSeconds: row.inboxPollSeconds || 180,
      inboxLastUid: row.inboxLastUid || 0,
    };
  }

  /**
   * 推进某个**账号**的收信 uid 水位（原来记在全局 mail_inbox_settings，
   * 多邮箱会互相覆盖；现在每个邮箱自己一份）。
   */
  async setInboxLastUid(uid: number, userId?: string, accountId?: string): Promise<void> {
    await this.ensureAccountsTable();
    if (userId) {
      const target = accountId
        ? await this.db
            .select({ id: smtpAccounts.id })
            .from(smtpAccounts)
            .where(and(eq(smtpAccounts.id, accountId), eq(smtpAccounts.ownerId, userId)))
            .limit(1)
        : await this.db
            .select({ id: smtpAccounts.id })
            .from(smtpAccounts)
            .where(eq(smtpAccounts.ownerId, userId))
            .orderBy(desc(smtpAccounts.isDefault), asc(smtpAccounts.createdAt))
            .limit(1);
      if (target[0]) {
        await this.db
          .update(smtpAccounts)
          .set({ inboxLastUid: uid })
          .where(eq(smtpAccounts.id, target[0].id));
        return;
      }
    }
    // 没有账号：退回旧的全局行（升级兼容）
    await this.ensureInboxTable();
    const existing = await this.db
      .select({ id: mailInboxSettings.id })
      .from(mailInboxSettings)
      .where(isNull(mailInboxSettings.ownerId))
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(mailInboxSettings)
        .set({ inboxLastUid: uid, updatedAt: new Date() })
        .where(eq(mailInboxSettings.id, existing[0].id));
    }
  }

  /** 保存 IMAP 配置（单行 upsert；先确保表存在） */
  async saveInboxSettings(input: {
    imapHost?: string | null;
    imapPort?: number;
    imapSecure?: boolean;
    inboxPollEnabled?: boolean;
    inboxPollSeconds?: number;
  }, userId?: string): Promise<void> {
    await this.ensureInboxTable();
    await this.ensureInboxOwnerColumn();
    const prev = await this.getImapSettings(userId);
    const values = {
      imapHost: input.imapHost !== undefined ? input.imapHost : prev.imapHost,
      imapPort: Number.isFinite(input.imapPort) ? Number(input.imapPort) : prev.imapPort,
      imapSecure: input.imapSecure !== undefined ? input.imapSecure !== false : prev.imapSecure,
      inboxPollEnabled:
        input.inboxPollEnabled !== undefined ? input.inboxPollEnabled : prev.inboxPollEnabled,
      inboxPollSeconds: Number.isFinite(input.inboxPollSeconds)
        ? Math.max(60, Number(input.inboxPollSeconds))
        : prev.inboxPollSeconds,
    };
    // drizzle 构建器（与 email_histories 同款已验证路径；raw execute 的 UPDATE 在生产库上会挂）
    // 只在"自己的行"里找：命中旧的全局行时就地认领，避免两个用户改同一行
    const existing = userId
      ? await this.db
          .select({ id: mailInboxSettings.id, ownerId: mailInboxSettings.ownerId })
          .from(mailInboxSettings)
          .where(eq(mailInboxSettings.ownerId, userId))
          .limit(1)
      : await this.db
          .select({ id: mailInboxSettings.id, ownerId: mailInboxSettings.ownerId })
          .from(mailInboxSettings)
          .where(isNull(mailInboxSettings.ownerId))
          .limit(1);

    if (existing[0]) {
      await this.db
        .update(mailInboxSettings)
        .set({ ...values, ownerId: userId ?? null, updatedAt: new Date() })
        .where(eq(mailInboxSettings.id, existing[0].id));
    } else if (userId) {
      await this.db.insert(mailInboxSettings).values({ ...values, ownerId: userId });
    } else {
      await this.db.insert(mailInboxSettings).values(values);
    }
  }

  /** 推进收信 uid 水位（drizzle 构建器，与 email_histories 同款已验证路径） */
  async saveSettings(input: {
    host: string;
    port: number;
    secure: boolean;
    username?: string | null;
    password?: string | null;
    fromName?: string | null;
    fromEmail: string;
    /** 保存为该用户的私有配置；不传 = 旧的全局单行行为 */
    userId?: string;
  }): Promise<void> {
    if (!input.host || !input.host.trim()) {
      throw new BadRequestException('SMTP 服务器不能为空');
    }
    if (!input.fromEmail || !input.fromEmail.includes('@')) {
      throw new BadRequestException('发件人邮箱格式不正确');
    }

    await this.ensureOwnerColumn();

    // 有 userId → 存进自建的 smtp_accounts（每人一行，is_default）
    if (input.userId) {
      const existing = await this.db
        .select({ id: smtpAccounts.id, password: smtpAccounts.password })
        .from(smtpAccounts)
        .where(eq(smtpAccounts.ownerId, input.userId))
        .orderBy(desc(smtpAccounts.isDefault), asc(smtpAccounts.createdAt))
        .limit(1);
      const row = existing[0];
      // 密码：填了用填的；没填且自己已有账号就用原值；
      // 都没就继承全局 smtp_config 的密码——**绝不能建一个空密码账号**。
      // （冒烟测试用 smtp-config POST 但没带密码，就这样建出过一个空密码的
      //   默认账号，之后发信全部失败。）
      let password =
        input.password !== undefined && input.password !== null && input.password !== ''
          ? input.password
          : row?.password ?? '';
      if (!password) {
        const global = await this.db
          .select({ password: smtpConfig.password })
          .from(smtpConfig)
          .orderBy(desc(smtpConfig.createdAt))
          .limit(1);
        password = global[0]?.password ?? '';
      }
      const values = {
        email: input.fromEmail.trim(),
        host: input.host.trim(),
        port: Number.isFinite(input.port) ? Number(input.port) : 465,
        secure: input.secure !== false,
        fromName: input.fromName !== undefined ? input.fromName : null,
        password,
      };

      if (row) {
        await this.db
          .update(smtpAccounts)
          .set(values)
          .where(eq(smtpAccounts.id, row.id));
      } else {
        await this.db.insert(smtpAccounts).values({
          ...values,
          ownerId: input.userId,
          isDefault: true,
        });
      }
      this.transporter = null;
      this.transporterKey = '';
      return;
    }

    // 无 userId → 旧的全局单行
    const existing = await this.getSettings();
    const values = {
      host: input.host.trim(),
      port: Number.isFinite(input.port) ? Number(input.port) : 465,
      secure: input.secure !== false,
      username: input.username !== undefined ? input.username : existing?.username ?? null,
      password:
        input.password !== undefined && input.password !== null && input.password !== ''
          ? input.password
          : existing?.password ?? null,
      fromName: input.fromName !== undefined ? input.fromName : existing?.fromName ?? null,
      fromEmail: input.fromEmail.trim(),
    };

    if (existing) {
      await this.db
        .update(smtpConfig)
        .set(values)
        .where(eq(smtpConfig.id, existing.id));
    } else {
      await this.db.insert(smtpConfig).values(values);
    }
    this.transporter = null;
    this.transporterKey = '';
  }

  private async getTransporter(userId?: string): Promise<Transporter> {
    const s = await this.getSettings(userId);
    if (!s || !s.host || !s.fromEmail) {
      throw new BadRequestException('系统尚未配置发信服务，请联系管理员在设置中配置 SMTP');
    }
    const key = JSON.stringify([s.host, s.port, s.secure, s.username, s.password]);
    if (this.transporter && this.transporterKey === key) {
      return this.transporter;
    }
    this.transporter = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: s.username ? { user: s.username, pass: s.password ?? '' } : undefined,
    });
    this.transporterKey = key;
    return this.transporter;
  }

  /** 发一封纯文本+HTML 邮件；SMTP 报原文错误由调用方决定如何呈现 */

  // ==================== 多个发信账号（邮箱后台） ====================

  /**
   * 给 smtp_config 加 owner_id（幂等）。表是自建的，owner 是自己，可以 ALTER。
   * 老行 owner_id 为 NULL = 旧全局配置，读取时作为回退，保证升级不破坏现有发信。
   */
  private async ensureOwnerColumn(): Promise<void> {
    // smtp_accounts 可能是全新库，先确保它存在，否则 ALTER 会报 relation does not exist
    await this.ensureAccountsTable();
    if (!this.ownerColumnPromise) {
      this.ownerColumnPromise = runIdempotentMigration(
        this.db,
        'smtp_config_owner_id',
        async (run) => {
          // smtp_config 是平台建的表，ALTER 会报 must be owner → 不能加列。
          // 每用户 SMTP 存自建的 smtp_accounts（owner_id），smtp_config 只当全局回退。
          await run('ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS owner_id varchar(64)');
          // 老库补列：收件配置跟着邮箱走
          for (const col of [
            'imap_host varchar(255)',
            'imap_port integer NOT NULL DEFAULT 993',
            'imap_secure boolean NOT NULL DEFAULT true',
            'inbox_poll_enabled boolean NOT NULL DEFAULT false',
            'inbox_poll_seconds integer NOT NULL DEFAULT 180',
            'inbox_last_uid integer NOT NULL DEFAULT 0',
          ]) {
            await run(`ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS ${col}`);
          }
          await run('CREATE INDEX IF NOT EXISTS idx_smtp_accounts_owner ON smtp_accounts (owner_id)');
        },
      )
        .then(() => undefined)
        .catch((err: unknown) => {
          this.ownerColumnPromise = null;
          throw err;
        });
    }
    return this.ownerColumnPromise;
  }

  /** 公开：收信轮询要按账号枚举（原来私有，只有增删改账号时用） */
  async ensureAccountsTable(): Promise<void> {
    if (!this.accountsTablePromise) {
      this.accountsTablePromise = runIdempotentMigration(
        this.db,
        'smtp_accounts',
        async (run) => {
          await run(`
            CREATE TABLE IF NOT EXISTS smtp_accounts (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              -- 归属用户；NULL = 未绑定到具体用户
              owner_id varchar(64),
              email varchar(320) NOT NULL,
              password text NOT NULL,
              host varchar(255) NOT NULL,
              port integer NOT NULL DEFAULT 465,
              secure boolean NOT NULL DEFAULT true,
              from_name varchar(255),
              is_default boolean NOT NULL DEFAULT false,
              -- 收件（IMAP）：跟着邮箱走，每个邮箱各自一套
              imap_host varchar(255),
              imap_port integer NOT NULL DEFAULT 993,
              imap_secure boolean NOT NULL DEFAULT true,
              inbox_poll_enabled boolean NOT NULL DEFAULT false,
              inbox_poll_seconds integer NOT NULL DEFAULT 180,
              inbox_last_uid integer NOT NULL DEFAULT 0,
              _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`);
          await run('ALTER TABLE smtp_accounts ADD COLUMN IF NOT EXISTS owner_id varchar(64)');
          await run(
            'GRANT ALL PRIVILEGES ON TABLE smtp_accounts TO anon_, authenticated_, service_role_',
          );
        },
      )
        .then(() => undefined)
        .catch((err: unknown) => {
          this.accountsTablePromise = null;
          throw err;
        });
    }
    return this.accountsTablePromise;
  }

  /** 列出全部发信账号（密码不外泄，只给 passwordSet） */
  /**
   * 列出发信账号。
   * 注意：这里**返回授权码明文**。用户明确要求"输入的所有信息直接保存、不需要隐藏"——
   * 编辑时要能看到并直接改当前值，而不是"留空表示不修改"。
   * 代价：能打开设置页的人都能看到 SMTP 授权码。已向用户说明这一权衡。
   */
  async listAccounts(ownerId?: string): Promise<
    {
      id: string; email: string; password: string;
      host: string; port: number; secure: boolean; fromName: string | null; isDefault: boolean;
      imapHost: string | null; imapPort: number; imapSecure: boolean;
      inboxPollEnabled: boolean; inboxPollSeconds: number;
    }[]
  > {
    try {
      await this.ensureAccountsTable();
      const rows = ownerId
        ? await this.db.select().from(smtpAccounts).where(eq(smtpAccounts.ownerId, ownerId))
            .orderBy(desc(smtpAccounts.isDefault), asc(smtpAccounts.createdAt))
        : await this.db.select().from(smtpAccounts)
            .where(isNull(smtpAccounts.ownerId))
            .orderBy(desc(smtpAccounts.isDefault), asc(smtpAccounts.createdAt));
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        password: r.password,
        host: r.host,
        port: r.port,
        secure: r.secure,
        fromName: r.fromName,
        isDefault: r.isDefault,
        imapHost: r.imapHost,
        imapPort: r.imapPort,
        imapSecure: r.imapSecure,
        inboxPollEnabled: r.inboxPollEnabled,
        inboxPollSeconds: r.inboxPollSeconds,
      }));
    } catch (err: unknown) {
      // 不能就这么返回空列表：实测过一次「部署后第一次请求」查询失败被这里吞掉，
      // 用户设置页里已经配好的账号凭空消失，看起来像数据丢了。
      // 先强制重跑一次建表/补列（清掉缓存的 promise），再试一次；
      // 真的不行才返回空，并且把错误写清楚。
      this.logger.warn(`读取发信账号失败，重试一次：${err instanceof Error ? err.message : String(err)}`);
      this.accountsTablePromise = null;
      try {
        await this.ensureAccountsTable();
        const retry = await this.db.select().from(smtpAccounts);
        return retry.map((r) => ({
          id: r.id,
          email: r.email,
          password: r.password,
          host: r.host,
          port: r.port,
          secure: r.secure,
          fromName: r.fromName,
          isDefault: r.isDefault,
          imapHost: r.imapHost,
          imapPort: r.imapPort,
          imapSecure: r.imapSecure,
          inboxPollEnabled: r.inboxPollEnabled,
          inboxPollSeconds: r.inboxPollSeconds,
        }));
      } catch (err2: unknown) {
        this.logger.error(
          `读取发信账号再次失败：${err2 instanceof Error ? err2.message : String(err2)}`,
        );
        return [];
      }
    }
  }

  /** 新增账号。同一邮箱只能有一个（重复后缀会让人分不清用哪个） */
  async addAccount(input: {
    ownerId?: string;
    email: string;
    imapHost?: string | null;
    imapPort?: number;
    imapSecure?: boolean;
    inboxPollEnabled?: boolean;
    inboxPollSeconds?: number;
    password: string;
    host: string;
    port: number;
    secure: boolean;
    fromName?: string;
  }): Promise<{ id: string }> {
    await this.ensureAccountsTable();
    const email = input.email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('邮箱地址格式不正确');
    }
    // 同一邮箱全局只能有一个（否则用户分不清用哪个）
    const dup = await this.db.select({ id: smtpAccounts.id }).from(smtpAccounts).where(eq(smtpAccounts.email, email)).limit(1);
    if (dup.length > 0) throw new BadRequestException(`发信账号 ${email} 已存在`);

    const existing = await this.db.select({ id: smtpAccounts.id }).from(smtpAccounts)
      .where(input.ownerId ? eq(smtpAccounts.ownerId, input.ownerId) : isNull(smtpAccounts.ownerId)).limit(1);
    const isFirst = existing.length === 0;
    const rows = await this.db.insert(smtpAccounts).values({
      ownerId: input.ownerId ?? null,
      email,
      imapHost: input.imapHost !== undefined ? input.imapHost : null,
      imapPort: Number.isFinite(input.imapPort) ? Number(input.imapPort) : 993,
      imapSecure: input.imapSecure !== false,
      inboxPollEnabled: input.inboxPollEnabled === true,
      inboxPollSeconds: Number.isFinite(input.inboxPollSeconds)
        ? Math.max(60, Number(input.inboxPollSeconds))
        : 180,
      password: input.password,
      host: input.host.trim(),
      port: input.port,
      secure: input.secure,
      fromName: input.fromName?.trim() || null,
      isDefault: isFirst, // 第一个账号自动设为默认
    }).returning({ id: smtpAccounts.id });
    return { id: rows[0].id };
  }

  /**
   * 更新发信账号（设置页点进某个邮箱后编辑用）。
   * ownerId 不匹配就不改——避免改到别人的账号。
   */
  async updateAccount(
    id: string,
    input: {
      email?: string;
      password?: string;
      host?: string;
      port?: number;
      secure?: boolean;
      fromName?: string | null;
      imapHost?: string | null;
      imapPort?: number;
      imapSecure?: boolean;
      inboxPollEnabled?: boolean;
      inboxPollSeconds?: number;
    },
    ownerId?: string,
  ): Promise<void> {
    await this.ensureAccountsTable();
    const rows = await this.db
      .select({ id: smtpAccounts.id, ownerId: smtpAccounts.ownerId })
      .from(smtpAccounts)
      .where(
        ownerId
          ? and(eq(smtpAccounts.id, id), eq(smtpAccounts.ownerId, ownerId))
          : eq(smtpAccounts.id, id),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new BadRequestException('发信账号不存在或无权修改');
    }
    const patch: Partial<typeof smtpAccounts.$inferInsert> = {};
    if (input.email !== undefined) patch.email = input.email.trim();
    if (input.password !== undefined) patch.password = input.password;
    if (input.host !== undefined) patch.host = input.host.trim();
    if (input.port !== undefined && Number.isFinite(input.port)) patch.port = Number(input.port);
    if (input.secure !== undefined) patch.secure = input.secure !== false;
    if (input.fromName !== undefined) patch.fromName = input.fromName?.trim() || null;
    if (input.imapHost !== undefined) patch.imapHost = input.imapHost?.trim() || null;
    if (input.imapPort !== undefined && Number.isFinite(input.imapPort)) patch.imapPort = Number(input.imapPort);
    if (input.imapSecure !== undefined) patch.imapSecure = input.imapSecure !== false;
    if (input.inboxPollEnabled !== undefined) patch.inboxPollEnabled = input.inboxPollEnabled === true;
    if (input.inboxPollSeconds !== undefined && Number.isFinite(input.inboxPollSeconds)) {
      patch.inboxPollSeconds = Math.max(60, Number(input.inboxPollSeconds));
    }
    if (Object.keys(patch).length === 0) return;
    await this.db.update(smtpAccounts).set(patch).where(eq(smtpAccounts.id, id));
    this.transporter = null;
    this.transporterKey = '';
  }

  async deleteAccount(id: string, ownerId?: string): Promise<void> {
    await this.ensureAccountsTable();
    await this.db.delete(smtpAccounts).where(
      ownerId ? and(eq(smtpAccounts.id, id), eq(smtpAccounts.ownerId, ownerId)) : eq(smtpAccounts.id, id),
    );
    // 删的是默认账号就把剩下的第一个设为默认，避免"没有默认账号"
    const left = await this.db.select({ id: smtpAccounts.id }).from(smtpAccounts).limit(1);
    if (left.length > 0) {
      await this.db.update(smtpAccounts).set({ isDefault: true }).where(eq(smtpAccounts.id, left[0].id));
    }
    this.accountTransporters.delete(id);
  }

  /** 设默认账号（发信时不指定就用它） */
  async setDefaultAccount(id: string, ownerId?: string): Promise<void> {
    await this.ensureAccountsTable();
    const scope = ownerId ? eq(smtpAccounts.ownerId, ownerId) : isNull(smtpAccounts.ownerId);
    await this.db.update(smtpAccounts).set({ isDefault: false }).where(scope);
    await this.db.update(smtpAccounts).set({ isDefault: true })
      .where(ownerId ? and(eq(smtpAccounts.id, id), scope) : eq(smtpAccounts.id, id));
  }

  /** 供邮件生成器取账号的收发信息（不含密码） */
  async getAccountForSend(id: string): Promise<{ id: string; email: string; fromName: string | null } | null> {
    const row = await this.getAccount(id);
    return row ? { id: row.id, email: row.email, fromName: row.fromName } : null;
  }

  /** 取某个账号的完整配置（含密码）；不存在返回 null */
  private async getAccount(id: string): Promise<typeof smtpAccounts.$inferSelect | null> {
    await this.ensureAccountsTable();
    const rows = await this.db.select().from(smtpAccounts).where(eq(smtpAccounts.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /** 按邮箱后缀（域名）取账号——下拉里选的就是后缀 */
  async getAccountByDomain(domain: string, ownerId?: string): Promise<typeof smtpAccounts.$inferSelect | null> {
    await this.ensureAccountsTable();
    const rows = ownerId
      ? await this.db.select().from(smtpAccounts).where(eq(smtpAccounts.ownerId, ownerId))
          .orderBy(desc(smtpAccounts.isDefault), asc(smtpAccounts.createdAt))
      : await this.db.select().from(smtpAccounts).where(isNull(smtpAccounts.ownerId))
          .orderBy(desc(smtpAccounts.isDefault), asc(smtpAccounts.createdAt));
    return rows.find((r) => r.email.toLowerCase().endsWith(`@${domain.trim().toLowerCase()}`)) ?? null;
  }

  private transporterFor(id: string, row: typeof smtpAccounts.$inferSelect): Transporter {
    const key = `${row.host}:${row.port}:${row.secure}:${row.password.length}:${row.password.slice(-4)}`;
    const cached = this.accountTransporters.get(id);
    if (cached && cached.key === key) return cached.transporter;
    const transporter = nodemailer.createTransport({
      host: row.host,
      port: row.port,
      secure: row.secure,
      auth: { user: row.email, pass: row.password },
    });
    this.accountTransporters.set(id, { key, transporter });
    return transporter;
  }

  /** 解析出实际要用的账号：指定 id > 指定域名 > 默认账号 > 旧全局 smtp_config */
  async resolveSender(accountId?: string, domain?: string, ownerId?: string): Promise<
    | { kind: 'account'; id: string; email: string; fromName: string | null; transporter: Transporter }
    | { kind: 'legacy'; email: string; fromName: string | null; transporter: Transporter }
  > {
    let row: typeof smtpAccounts.$inferSelect | null = null;
    if (accountId) {
      row = await this.getAccount(accountId);
      // 明确指定了账号却找不到 → 直接报错。
      // 静默回退会让"选错/删错账号"变成用另一个地址发信，客户看到意外的发件人，
      // 而且事后无法从发送记录里发现（From 会是默认账号）。
      if (!row) {
        throw new BadRequestException(
          `发信账号不存在（id=${accountId}），可能已被删除。请在设置里重新选择。`,
        );
      }
    }
    if (!row && domain) row = await this.getAccountByDomain(domain, ownerId);
    if (!row && ownerId) {
      const rows = await this.db.select().from(smtpAccounts)
        .where(and(eq(smtpAccounts.isDefault, true), eq(smtpAccounts.ownerId, ownerId))).limit(1);
      row = rows[0] ?? null;
    }
    if (!row) {
      const rows = await this.db.select().from(smtpAccounts)
        .where(and(eq(smtpAccounts.isDefault, true), isNull(smtpAccounts.ownerId))).limit(1);
      row = rows[0] ?? null;
    }
    if (row) {
      return {
        kind: 'account',
        id: row.id,
        email: row.email,
        fromName: row.fromName,
        transporter: this.transporterFor(row.id, row),
      };
    }
    // 没有任何账号时退回旧全局配置（老部署不破坏）
    const s = await this.getSettings();
    if (!s) throw new BadRequestException('尚未配置发信账号，请在设置里添加');
    return { kind: 'legacy', email: s.fromEmail, fromName: s.fromName, transporter: await this.getTransporter() };
  }

  async sendMail(opts: {
    to: string;
    subject: string;
    text: string;
    html: string;
    /** 指定用哪个发信账号；不传走默认（有账号时）或旧全局配置 */
    accountId?: string;
    /** 或按邮箱后缀指定（下拉里选的就是后缀） */
    domain?: string;
  }): Promise<void> {
    const sender = await this.resolveSender(opts.accountId, opts.domain);
    const fromAddr = sender.email;
    const fromName = sender.fromName;
    const transporter = sender.transporter;
    try {
      await transporter.sendMail({
        from: fromName ? `"${fromName}" <${fromAddr}>` : fromAddr,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMTP send failed: ${msg}`);
      throw new BadRequestException(`发信失败：${msg}`);
    }
  }

  /**
   * 发送原始 RFC822 报文（BD 群发邮件用）：
   * 报文由 eml-generator 组装（multipart/related + CID 内嵌图），
   * From/To/Subject 都在报文头里。**必须显式传 envelope** ——
   * nodemailer 的 raw 模式不解析报文头，缺 envelope 会报
   * "No recipients defined"（收件人取报文 To，寄件人取 SMTP 配置的 fromEmail）。
   */
  async sendRaw(
    raw: string,
    envelope: { from: string; to: string[] },
    /** 指定发信账号；不传走默认/全局 */
    accountId?: string,
    /** 当前用户：决定用谁的 SMTP（每用户独立） */
    userId?: string,
  ): Promise<{ messageId: string | null }> {
    const sender = accountId
      ? await this.resolveSender(accountId, undefined, userId)
      : userId
        ? await this.resolveSender(undefined, undefined, userId)
        : null;
    const transporter = sender ? sender.transporter : await this.getTransporter(userId);
    try {
      const info = await transporter.sendMail({ raw, envelope } as Parameters<Transporter['sendMail']>[0]);
      const messageId = (info as { messageId?: string }).messageId ?? null;
      return { messageId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMTP raw send failed: ${msg}`);
      throw new BadRequestException(`发信失败：${msg}`);
    }
  }

  /** 管理员点「测试发信」 */
  async sendTestMail(to: string): Promise<void> {
    const stamp = new Date().toLocaleString('zh-CN');
    await this.sendMail({
      to,
      subject: '发信服务测试',
      text: `这是一封来自邮件收发助手的测试邮件，发送时间 ${stamp}。收到即表示 SMTP 配置可用。`,
      html: `<p>这是一封来自 <strong>邮件收发助手</strong> 的测试邮件。</p><p>发送时间：${stamp}</p><p>收到即表示 SMTP 配置可用。</p>`,
    });
  }
}
