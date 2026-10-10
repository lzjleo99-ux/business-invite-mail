import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, sql, ilike, max, inArray } from 'drizzle-orm';
import { modelConfig, projects, restaurants } from '@server/database/schema';
import { RestaurantsService } from '../restaurants/restaurants.service';
import type { UserContext } from '../restaurants/restaurants.service';
import type {
  ImportSecretConfig,
  AutoImportLead,
  AutoImportResponse,
} from '@shared/api.interface';

type LeadFieldKey =
  | 'seqNo'
  | 'name'
  | 'country'
  | 'address'
  | 'website'
  | 'phone'
  | 'email'
  | 'verifyStatus'
  | 'source'
  | 'latitude'
  | 'longitude';

const LEAD_FIELD_ALIASES: Record<LeadFieldKey, string[]> = {
  seqNo: ['序号', 'No.', 'No', 'no.', 'no', 'number', '编号', '序', 'seqNo'],
  name: [
    '名称 Name', '名称', 'Name', 'name', '公司名称', '餐厅名称',
    'Company', 'company', '企业名称', '客户名称', '单位名称',
    '公司名', '企业名', '店名', '品牌名称', '品牌',
  ],
  country: [
    '国家/地区', 'Country/Region', 'Country', 'country',
    '国家', '地区', 'Region', 'region', '所在国家', '所在地区',
  ],
  address: [
    '地址 Address', '地址', 'Address', 'address',
    'Location', 'location', '详细地址', '公司地址', '企业地址',
    '办公地址', '经营地址',
  ],
  website: [
    '网站 Website', '网站', 'Website', 'website', '网址',
    'Web', 'web', 'Site', 'site', '官网', '官方网站',
    '公司网址', '企业网址', '主页', '首页',
  ],
  phone: [
    '电话 Phone', '电话', 'Phone', 'phone', 'Tel', 'tel',
    'Telephone', 'telephone', '联系方式', '联系电话', '手机号码',
    '手机', '传真', 'Fax', 'fax', '公司电话', '企业电话',
  ],
  email: [
    '邮箱 Email', '邮箱', 'Email', 'email', 'E-mail', 'e-mail',
    'Mail', 'mail', '电子邮箱', '邮件地址', '联系邮箱',
    '公司邮箱', '企业邮箱', 'E-mail地址', 'email地址',
  ],
  verifyStatus: [
    '核验状态', 'Verification', 'verification',
    'Verification Status', 'verification status',
    '状态', 'Status', 'status', '验证状态', '审核状态',
    '校验状态',
  ],
  source: [
    '来源 Source', '来源', 'Source (Google Maps)', 'Source', 'source',
    '数据来源', 'Source(Google Maps)', '信息来源', '渠道来源',
  ],
  latitude: [
    '纬度 Lat', '纬度', 'Lat', 'lat', 'Latitude', 'latitude',
    'Lat.', 'lat.',
  ],
  longitude: [
    '经度 Lng', '经度', 'Lng', 'lng', 'Longitude', 'longitude',
    'Lon', 'lon', 'Long', 'long', 'Lng.', 'lng.',
  ],
};

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/[\s\-_/\\.、，,；;:：]+/g, '')
    .trim();
}

const HEADER_MAP: Record<string, LeadFieldKey> = (() => {
  const map: Record<string, LeadFieldKey> = {};
  for (const [fieldName, aliases] of Object.entries(LEAD_FIELD_ALIASES)) {
    for (const alias of aliases) {
      const key = normalizeHeader(alias);
      if (key && !(key in map)) {
        map[key] = fieldName as LeadFieldKey;
      }
    }
  }
  return map;
})();

function normalizeName(value: string | null): string | null {
  if (!value) return null;
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeEmail(value: string | null): string | null {
  if (!value) return null;
  return value.trim().toLowerCase();
}

function normalizeWebsite(value: string | null): string | null {
  if (!value) return null;
  let url = value.trim().toLowerCase();
  url = url.replace(/^https?:\/\//, '');
  url = url.replace(/^www\./, '');
  const slashIdx = url.search(/[\/?#:]/);
  if (slashIdx !== -1) {
    url = url.slice(0, slashIdx);
  }
  return url || null;
}

function maskSecret(secret: string): string {
  if (secret.length <= 4) return '****';
  return `${secret.slice(0, 2)}****${secret.slice(-2)}`;
}

@Injectable()
export class AutoImportService {
  private readonly logger = new Logger(AutoImportService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly restaurantsService: RestaurantsService,
  ) {}

  async getImportSecretConfig(): Promise<ImportSecretConfig> {
    try {
      const result = await this.db.execute(sql<{ import_secret: string | null }>`
        SELECT import_secret FROM ${modelConfig} LIMIT 1
      `);
      const row = result[0] as { import_secret: string | null } | undefined;
      const secret: string | null = row?.import_secret ?? null;
      return {
        importSecretSet: !!secret,
        importSecretMasked: secret ? maskSecret(secret) : null,
      };
    } catch (err) {
      this.logger.warn(`Failed to read import_secret column: ${String(err)}`);
      return { importSecretSet: false, importSecretMasked: null };
    }
  }

  async setImportSecret(secret: string): Promise<ImportSecretConfig> {
    if (!secret || secret.trim().length < 6) {
      throw new BadRequestException('Import secret 至少 6 个字符');
    }
    const trimmed: string = secret.trim();

    // Check if any row exists
    const existing = await this.db
      .select({ id: modelConfig.id })
      .from(modelConfig)
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException('model_config 不存在，请先完成模型设置');
    }

    try {
      const secretVal: string = trimmed;
      await this.db.execute(sql`
        UPDATE ${modelConfig}
        SET import_secret = ${secretVal}
        WHERE id = ${existing[0].id}
      `);
    } catch (err) {
      this.logger.error(`Failed to update import_secret: ${String(err)}`);
      throw new BadRequestException(
        '写入 import_secret 失败，请确认列已存在',
      );
    }

    return {
      importSecretSet: true,
      importSecretMasked: maskSecret(trimmed),
    };
  }

  async importLeads(
    projectName: string,
    rawLeads: Array<Record<string, unknown>>,
    secretHeader: string | undefined,
  ): Promise<AutoImportResponse> {
    // Validate secret
    const stored = await this.readStoredSecret();
    if (!stored) {
      throw new UnauthorizedException('Import secret 未配置');
    }
    if (!secretHeader || secretHeader.trim() !== stored) {
      throw new UnauthorizedException('Import secret 无效');
    }

    if (!projectName || !projectName.trim()) {
      throw new BadRequestException('projectName 不能为空');
    }
    if (!rawLeads || !Array.isArray(rawLeads)) {
      throw new BadRequestException('leads 必须是数组');
    }

    // Find or create project (case-insensitive)
    const projectId = await this.findOrCreateProject(projectName.trim());

    // Map raw leads to AutoImportLead
    const leads: AutoImportLead[] = rawLeads.map(
      (raw: Record<string, unknown>): AutoImportLead =>
        this.mapRawLead(raw),
    );

    // Fetch existing normalized keys for dedup
    const existingKeys = await this.getExistingNormalizedKeys(projectId);

    let imported = 0;
    let duplicates = 0;
    const seenBatchNames = new Set<string>();
    const seenBatchEmails = new Set<string>();
    const seenBatchWebsites = new Set<string>();

    for (const lead of leads) {
      if (!lead.name || !lead.name.trim()) {
        continue;
      }

      const nameKey = normalizeName(lead.name ?? null);
      const emailKey = normalizeEmail(lead.email ?? null);
      const websiteKey = normalizeWebsite(lead.website ?? null);

      const isDuplicate = this.checkDuplicate(
        nameKey,
        emailKey,
        websiteKey,
        existingKeys,
        seenBatchNames,
        seenBatchEmails,
        seenBatchWebsites,
      );

      if (isDuplicate) {
        duplicates += 1;
        continue;
      }

      // Add to batch seen sets
      if (nameKey) seenBatchNames.add(nameKey);
      if (emailKey) seenBatchEmails.add(emailKey);
      if (websiteKey) seenBatchWebsites.add(websiteKey);

      await this.restaurantsService.createLead(projectId, lead, {
        userId: 'system_auto_import',
        role: 'admin',
      });
      imported += 1;
    }

    return {
      projectId,
      projectUrl: `/projects/${projectId}`,
      imported,
      duplicates,
    };
  }

  private async readStoredSecret(): Promise<string | null> {
    try {
      const result = await this.db.execute(sql<{ import_secret: string | null }>`
        SELECT import_secret FROM ${modelConfig} LIMIT 1
      `);
      const row = result[0] as { import_secret: string | null } | undefined;
      const val: string | null = row?.import_secret ?? null;
      return val;
    } catch (err) {
      this.logger.warn(`Failed to read import_secret: ${String(err)}`);
      return null;
    }
  }

  private async findOrCreateProject(name: string): Promise<string> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(ilike(projects.name, name));

    if (rows.length > 0) {
      return rows[0].id;
    }

    const maxOrderResult = await this.db
      .select({ max: max(projects.sortOrder) })
      .from(projects);
    const nextSortOrder =
      ((maxOrderResult[0]?.max as number | null) ?? 0) + 1;

    const inserted = await this.db
      .insert(projects)
      .values({
        name,
        description: 'Auto-created by auto-import',
        sortOrder: nextSortOrder,
      })
      .returning({ id: projects.id });

    return inserted[0].id;
  }

  private mapRawLead(raw: Record<string, unknown>): AutoImportLead {
    const result: AutoImportLead = {};

    for (const [key, value] of Object.entries(raw)) {
      const normalized = normalizeHeader(key);
      const fieldName = HEADER_MAP[normalized];
      if (!fieldName) continue;
      if (value === null || value === undefined) continue;

      const strVal = String(value);

      switch (fieldName) {
        case 'seqNo': {
          const n = Number(strVal);
          result.seqNo = Number.isFinite(n) ? n : null;
          break;
        }
        case 'latitude': {
          const n = Number(strVal);
          result.latitude = Number.isFinite(n) ? n : null;
          break;
        }
        case 'longitude': {
          const n = Number(strVal);
          result.longitude = Number.isFinite(n) ? n : null;
          break;
        }
        case 'name':
          result.name = strVal.trim() || null;
          break;
        case 'country':
          result.country = strVal.trim() || null;
          break;
        case 'address':
          result.address = strVal.trim() || null;
          break;
        case 'website':
          result.website = strVal.trim() || null;
          break;
        case 'phone':
          result.phone = strVal.trim() || null;
          break;
        case 'email':
          result.email = strVal.trim() || null;
          break;
        case 'verifyStatus':
          result.verifyStatus = strVal.trim() || null;
          break;
        case 'source':
          result.source = strVal.trim() || null;
          break;
        default:
          break;
      }
    }

    return result;
  }

  private async getExistingNormalizedKeys(projectId: string): Promise<{
    names: Set<string>;
    emails: Set<string>;
    websites: Set<string>;
  }> {
    const rows = await this.db
      .select({
        name: restaurants.name,
        email: restaurants.email,
        website: restaurants.website,
      })
      .from(restaurants)
      .where(eq(restaurants.projectId, projectId));

    const names = new Set<string>();
    const emails = new Set<string>();
    const websites = new Set<string>();

    for (const row of rows) {
      const nk = normalizeName(row.name ?? null);
      if (nk) names.add(nk);
      const ek = normalizeEmail(row.email ?? null);
      if (ek) emails.add(ek);
      const wk = normalizeWebsite(row.website ?? null);
      if (wk) websites.add(wk);
    }

    return { names, emails, websites };
  }

  private checkDuplicate(
    nameKey: string | null,
    emailKey: string | null,
    websiteKey: string | null,
    existing: {
      names: Set<string>;
      emails: Set<string>;
      websites: Set<string>;
    },
    batchNames: Set<string>,
    batchEmails: Set<string>,
    batchWebsites: Set<string>,
  ): boolean {
    if (nameKey && (existing.names.has(nameKey) || batchNames.has(nameKey))) {
      return true;
    }
    if (emailKey && (existing.emails.has(emailKey) || batchEmails.has(emailKey))) {
      return true;
    }
    if (
      websiteKey &&
      (existing.websites.has(websiteKey) || batchWebsites.has(websiteKey))
    ) {
      return true;
    }
    return false;
  }
}
