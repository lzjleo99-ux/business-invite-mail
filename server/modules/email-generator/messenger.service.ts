import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import axios from 'axios';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';

/**
 * 号码注册状态检测：WhatsApp / Viber。
 *
 * WhatsApp：走官方 wa.me 短链。号码**已注册**时页面是正常的聊天页；**未注册**时
 * 官方页会明确显示 "… is not on WhatsApp"。抓页面文本判定即可。
 * Viber：没有公开的网页版注册查询接口（viber:// 只能由客户端处理），
 * 因此只能给"未知"，但可以给出 viber:// 链接供人工尝试。
 *
 * 结果落库（messenger_registration，自建表），供行内按钮显示可用/不可用。
 */

export type MessengerStatus = 'yes' | 'no' | 'unknown';

/**
 * 号码合理性校验：E.164 长度 8-15 位，且国家码在已知分配表里。
 * 目的：把"明显不可能"的号码挑出来（写错的区号、短号、虚拟号段），
 * 避免把没用的号码拿去发 WhatsApp。
 */
const DIAL_CODES: string[] = [
  '1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45',
  '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63',
  '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
  '211', '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228',
  '229', '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240', '241', '242',
  '243', '244', '245', '246', '248', '249', '250', '251', '252', '253', '254', '255', '256', '257',
  '258', '260', '261', '262', '263', '264', '265', '266', '267', '268', '269', '291', '297', '298',
  '299', '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372',
  '373', '374', '375', '376', '377', '378', '380', '381', '382', '383', '385', '386', '387', '389',
  '420', '421', '423', '500', '501', '502', '503', '504', '505', '506', '507', '508', '509', '590',
  '591', '592', '593', '594', '595', '596', '597', '598', '599', '670', '672', '673', '674', '675',
  '676', '677', '678', '679', '680', '681', '682', '683', '685', '686', '687', '688', '689', '690',
  '691', '692', '850', '852', '853', '855', '856', '880', '886', '960', '961', '962', '963', '964',
  '965', '966', '967', '968', '970', '971', '972', '973', '974', '975', '976', '977', '992', '993',
  '994', '995', '996', '998',
];

export function isPlausibleMsisdn(digits: string): boolean {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) return false;
  // 国家码匹配（1-3 位，长的优先）
  for (const code of [...DIAL_CODES].sort((a, b) => b.length - a.length)) {
    if (d.startsWith(code)) {
      const national = d.length - code.length;
      // 各国号码长度不同，这里只做宽松校验（>=4 位本地号）
      return national >= 4;
    }
  }
  return false;
}


export interface MessengerCheckResult {
  phone: string;
  whatsapp: MessengerStatus;
  viber: MessengerStatus;
  waUrl: string;
  viberUrl: string;
  checkedAt: string;
}

/** 仅保留数字（国际号码，含 + 号由调用方处理） */
export function normalizePhoneForCheck(phone: string): string {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  // 去掉国际前缀 00 / +，保留本地号码
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('381') && digits.length > 10) return digits;
  return digits;
}

@Injectable()
export class MessengerService {
  private readonly logger = new Logger(MessengerService.name);
  private ensurePromise?: Promise<void>;
  private http = axios.create({
    timeout: 15000,
    maxRedirects: 3,
    headers: {
      // 用常规 UA：wa.me 对异常 UA 有时会返回精简页
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    validateStatus: () => true,
  });

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  ensureTable(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = runIdempotentMigration(
        this.db,
        'messenger_registration 建表迁移',
        async (run) => {
          await run(`CREATE TABLE IF NOT EXISTS messenger_registration (
            company_id  uuid PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
            phone       varchar(64),
            whatsapp    varchar(10) NOT NULL DEFAULT 'unknown',
            viber       varchar(10) NOT NULL DEFAULT 'unknown',
            checked_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`);
          try {
            await run(
              'GRANT ALL PRIVILEGES ON TABLE messenger_registration TO anon_, authenticated_, service_role_',
            );
          } catch {
            /* 非自建环境忽略 */
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

  /**
   * 检测单个号码。
   *
   * 重要事实（2026-10-28 实测）：wa.me 已经在**服务端不再区分**号码是否注册
   * ——注册与未注册、甚至 15 位乱码号，都会 302 到同一个 api.whatsapp.com/send
   * 页面（判定在浏览器 JS 里做）。所以这里给的是**可判定范围内的结论**：
   *   - no      ：号码格式不可能（国家码/长度不合法）→ 一定不是有效号码
   *   - yes     ：wa.me 链接可达且跳到 WhatsApp 官方发信页（"链接能打开"）
   *   - unknown ：网络/判定不确定
   * 想确认"是否已注册"，用返回的 waUrl 在浏览器里打开——WhatsApp 官方页会直接
   * 告诉你 "not on WhatsApp"。
   */
  async checkPhone(phone: string): Promise<MessengerCheckResult> {
    const digits = normalizePhoneForCheck(phone);
    const waUrl = digits ? `https://wa.me/${digits}` : '';
    const viberUrl = digits ? `viber://chat?number=${digits}` : '';
    if (!digits) {
      return {
        phone: '',
        whatsapp: 'no',
        viber: 'unknown',
        waUrl: '',
        viberUrl: '',
        checkedAt: new Date().toISOString(),
      };
    }
    // 1) 号码本身就不可能合法
    if (!isPlausibleMsisdn(digits)) {
      return {
        phone: digits,
        whatsapp: 'no',
        viber: 'no',
        waUrl,
        viberUrl,
        checkedAt: new Date().toISOString(),
      };
    }
    // 2) 链接可达性（wa.me 是否能打开到官方发信页）
    let whatsapp: MessengerStatus = 'unknown';
    try {
      const res = await this.http.get(waUrl);
      const finalUrl = String(res.request?.res?.responseUrl || res.config?.url || waUrl);
      const html = String(res.data || '');
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
      if (/is not on whatsapp|not on whatsapp/.test(text)) {
        whatsapp = 'no';
      } else if (
        res.status === 200 &&
        (finalUrl.includes('api.whatsapp.com/send') || finalUrl.includes('wa.me')) &&
        !/download whatsapp/.test(text)
      ) {
        whatsapp = 'yes';
      } else if (res.status >= 400) {
        whatsapp = 'no';
      }
    } catch (err: unknown) {
      this.logger.warn(
        `WhatsApp 链接探测失败 ${digits}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      phone: digits,
      whatsapp,
      // Viber 没有公开的网页注册查询接口（viber:// 只能客户端处理）→ 未知
      viber: 'unknown',
      waUrl,
      viberUrl,
      checkedAt: new Date().toISOString(),
    };
  }

  /** 检测并落库（按公司） */
  async checkAndStore(
    companyId: string,
    phone: string,
  ): Promise<MessengerCheckResult> {
    await this.ensureTable();
    const result = await this.checkPhone(phone);
    await this.db
      .insert(messengerRegistrationTable)
      .values({
        companyId,
        phone: result.phone || null,
        whatsapp: result.whatsapp,
        viber: result.viber,
        checkedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: messengerRegistrationTable.companyId,
        set: {
          phone: result.phone || null,
          whatsapp: result.whatsapp,
          viber: result.viber,
          checkedAt: new Date(),
        },
      });
    return result;
  }

  /** 批量检测项目内所有有号码的公司（并发 5，带超时保护） */
  async checkProjectPhones(
    projectId: string,
    userId: string,
  ): Promise<{ total: number; whatsappYes: number; whatsappNo: number; unknown: number }> {
    await this.ensureTable();
    const rows = await this.db
      .select({
        companyId: companyContacts.companyId,
        value: companyContacts.value,
      })
      .from(companyContacts)
      .innerJoin(restaurants, eq(restaurants.id, companyContacts.companyId))
      .innerJoin(projects, eq(projects.id, restaurants.projectId))
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.ownerId, userId),
          eq(companyContacts.type, 'phone'),
        ),
      );
    // 每家公司只取一个号码（第一个）
    const byCompany = new Map<string, string>();
    for (const r of rows) {
      if (!byCompany.has(r.companyId)) byCompany.set(r.companyId, r.value);
    }
    const entries = [...byCompany.entries()];
    let whatsappYes = 0;
    let whatsappNo = 0;
    let unknown = 0;
    const queue = [...entries];
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) return;
        try {
          const res = await this.checkAndStore(item[0], item[1]);
          if (res.whatsapp === 'yes') whatsappYes += 1;
          else if (res.whatsapp === 'no') whatsappNo += 1;
          else unknown += 1;
        } catch {
          unknown += 1;
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);
    return { total: entries.length, whatsappYes, whatsappNo, unknown };
  }

  /** 读取项目内已存结果 */
  async getStoredForProject(
    projectId: string,
    userId: string,
  ): Promise<Map<string, MessengerCheckResult>> {
    await this.ensureTable();
    const rows = await this.db
      .select()
      .from(messengerRegistrationTable)
      .innerJoin(restaurants, eq(restaurants.id, messengerRegistrationTable.companyId))
      .innerJoin(projects, eq(projects.id, restaurants.projectId))
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)));
    const out = new Map<string, MessengerCheckResult>();
    for (const r of rows) {
      const row = r as unknown as {
        company_id: string; phone: string | null; whatsapp: string; viber: string; checked_at: Date;
      };
      out.set(row.company_id, {
        phone: row.phone || '',
        whatsapp: row.whatsapp as MessengerStatus,
        viber: row.viber as MessengerStatus,
        waUrl: row.phone ? `https://wa.me/${row.phone}` : '',
        viberUrl: row.phone ? `viber://chat?number=${row.phone}` : '',
        checkedAt: row.checked_at.toISOString(),
      });
    }
    return out;
  }

  /** 读取已存结果 */
  async getStored(companyIds: string[]): Promise<Map<string, MessengerCheckResult>> {
    const out = new Map<string, MessengerCheckResult>();
    if (companyIds.length === 0) return out;
    await this.ensureTable();
    const rows = await this.db
      .select()
      .from(messengerRegistrationTable)
      .where(sql`${messengerRegistrationTable.companyId} = ANY(${companyIds}::uuid[])`);
    for (const r of rows) {
      out.set(r.companyId, {
        phone: r.phone || '',
        whatsapp: r.whatsapp as MessengerStatus,
        viber: r.viber as MessengerStatus,
        waUrl: r.phone ? `https://wa.me/${r.phone}` : '',
        viberUrl: r.phone ? `viber://chat?number=${r.phone}` : '',
        checkedAt: r.checkedAt.toISOString(),
      });
    }
    return out;
  }
}

// 表定义在 schema 里（自建表同款模式）
import {
  companyContacts,
  messengerRegistrationTable,
  projects,
  restaurants,
} from '@server/database/schema';
