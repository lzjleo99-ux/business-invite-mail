import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, ilike, sql, inArray, or, isNull, isNotNull, ne } from 'drizzle-orm';
import { restaurants } from '@server/database/schema';
import type {
  Company,
  CompanyStatus,
  CompanyListParams,
  CompanyListResponse,
  CompanyStatsResponse,
  ImportResult,
  UpdateEmailRequest,
  DuplicateGroup,
  AutoImportLead,
  ContactStatus,
  StatsFilterKey,
} from '@shared/api.interface';
import { normalizePhone } from '../../common/utils/phone-normalizer';

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

const FIELD_ALIASES: Record<string, string[]> = {
  seqNo: ['序号', 'No.', 'No', 'no.', 'no', 'number', '编号', '序'],
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
    '地址 Address', '地址', 'Address', 'address', '地址地址',
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

const NORMALIZED_HEADER_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [fieldName, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const key = normalizeHeader(alias);
      if (key && !(key in map)) {
        map[key] = fieldName;
      }
    }
  }
  return map;
})();

type RawRow = Record<string, unknown>;

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
  // Take everything before first /, ?, or : (port)
  const slashIdx = url.search(/[\/?#:]/);
  if (slashIdx !== -1) {
    url = url.slice(0, slashIdx);
  }
  return url || null;
}

@Injectable()
export class RestaurantsService {
  private readonly logger = new Logger(RestaurantsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async findAll(params: CompanyListParams): Promise<CompanyListResponse> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize =
      params.pageSize && params.pageSize > 0 ? params.pageSize : 20;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(restaurants.projectId, params.projectId)];
    if (params.status) {
      conditions.push(eq(restaurants.status, params.status));
    }
    if (params.search) {
      conditions.push(ilike(restaurants.name, `%${params.search}%`));
    }
    if (params.noEmail) {
      conditions.push(
        or(isNull(restaurants.email), eq(restaurants.email, '')),
      );
    }
    if (params.isStarred !== undefined) {
      conditions.push(eq(restaurants.isStarred, params.isStarred));
    }
    if (params.filterKey && params.filterKey !== 'all') {
      const filterConditions = this.buildFilterKeyCondition(params.filterKey);
      if (filterConditions) {
        conditions.push(filterConditions);
      }
    }

    const whereClause = and(...conditions);

    const [countResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(restaurants)
        .where(whereClause),
      this.db
        .select()
        .from(restaurants)
        .where(whereClause)
        .orderBy(desc(restaurants.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((r) => this.mapRowToCompany(r)),
      total,
      page,
      pageSize,
    };
  }

  async getStats(projectId: string): Promise<CompanyStatsResponse> {
    const result = await this.db.execute(sql<{
      total: number;
      analyzed: number;
      generated: number;
      noemail: number;
      failed: number;
      starred: number;
      pending: number;
      hasphone: number;
      haswhatsapp: number;
    }>`
      SELECT
        count(*) AS total,
        count(*) FILTER (
          WHERE ${restaurants.status} IN ('analyzed', 'generating', 'generated')
        ) AS analyzed,
        count(*) FILTER (
          WHERE ${restaurants.status} = 'generated'
        ) AS generated,
        count(*) FILTER (
          WHERE ${restaurants.email} IS NULL OR ${restaurants.email} = ''
        ) AS noemail,
        count(*) FILTER (
          WHERE ${restaurants.status} = 'failed'
        ) AS failed,
        count(*) FILTER (
          WHERE ${restaurants.isStarred} = true
        ) AS starred,
        count(*) FILTER (
          WHERE ${restaurants.status} = 'pending'
        ) AS pending,
        count(*) FILTER (
          WHERE ${restaurants.phone} IS NOT NULL AND ${restaurants.phone} != ''
        ) AS hasphone,
        count(*) FILTER (
          WHERE ${restaurants.normalizedWhatsappPhone} IS NOT NULL AND ${restaurants.normalizedWhatsappPhone} != ''
        ) AS haswhatsapp
      FROM ${restaurants}
      WHERE ${restaurants.projectId} = ${projectId}
    `);

    const row = result[0];
    if (!row) {
      return {
        total: 0,
        analyzed: 0,
        generated: 0,
        noEmail: 0,
        failed: 0,
        starred: 0,
        pending: 0,
        hasPhone: 0,
        hasWhatsapp: 0,
      };
    }

    return {
      total: Number(row.total),
      analyzed: Number(row.analyzed),
      generated: Number(row.generated),
      noEmail: Number(row.noemail),
      failed: Number(row.failed),
      starred: Number(row.starred),
      pending: Number(row.pending),
      hasPhone: Number(row.hasphone),
      hasWhatsapp: Number(row.haswhatsapp),
    };
  }

  async toggleStar(id: string, isStarred: boolean): Promise<Company> {
    const updated = await this.db
      .update(restaurants)
      .set({ isStarred })
      .where(eq(restaurants.id, id))
      .returning({ id: restaurants.id });

    if (updated.length === 0) {
      throw new NotFoundException('公司不存在');
    }

    return this.findOne(id);
  }

  async updateContactStatus(
    id: string,
    type: 'whatsapp' | 'viber' | 'email',
    contacted: boolean,
  ): Promise<Company> {
    const existing = await this.db
      .select({ id: restaurants.id, contactStatus: restaurants.contactStatus })
      .from(restaurants)
      .where(eq(restaurants.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException('公司不存在');
    }

    const currentStatus: ContactStatus =
      (existing[0].contactStatus as ContactStatus | null) ?? {};

    const fieldKey = `${type}ContactedAt` as keyof ContactStatus;
    const newStatus: ContactStatus = { ...currentStatus };

    if (contacted) {
      newStatus[fieldKey] = new Date().toISOString();
    } else {
      newStatus[fieldKey] = null;
    }

    await this.db
      .update(restaurants)
      .set({ contactStatus: newStatus as unknown as Record<string, unknown> })
      .where(eq(restaurants.id, id));

    return this.findOne(id);
  }

  async normalizePhonesByProject(projectId: string): Promise<{ processed: number }> {
    const rows = await this.db
      .select({ id: restaurants.id, phone: restaurants.phone, country: restaurants.country })
      .from(restaurants)
      .where(eq(restaurants.projectId, projectId));

    let processed = 0;
    for (const row of rows) {
      if (!row.phone) continue;
      const result = normalizePhone(row.phone, row.country);
      await this.db
        .update(restaurants)
        .set({
          normalizedPhone: result.normalizedPhone,
          phoneType: result.phoneType,
          normalizedWhatsappPhone: result.whatsappPhone,
        })
        .where(eq(restaurants.id, row.id));
      processed += 1;
    }

    return { processed };
  }

  private buildFilterKeyCondition(
    filterKey: StatsFilterKey,
  ): ReturnType<typeof eq> | ReturnType<typeof and> | ReturnType<typeof or> | null {
    switch (filterKey) {
      case 'starred':
        return eq(restaurants.isStarred, true);
      case 'analyzed':
        return sql`${restaurants.status} IN ('analyzed', 'generating', 'generated')` as unknown as ReturnType<typeof eq>;
      case 'pending':
        return eq(restaurants.status, 'pending');
      case 'generated':
        return eq(restaurants.status, 'generated');
      case 'no_email':
        return or(isNull(restaurants.email), eq(restaurants.email, ''));
      case 'failed':
        return eq(restaurants.status, 'failed');
      default:
        return null;
    }
  }

  async findOne(id: string): Promise<Company> {
    const rows = await this.db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, id));

    if (rows.length === 0) {
      throw new NotFoundException('公司不存在');
    }

    return this.mapRowToCompany(rows[0]);
  }

  async importFromExcel(
    fileBuffer: Buffer,
    mode: 'append' | 'overwrite',
    projectId: string,
    fileName: string,
  ): Promise<ImportResult> {
    if (mode !== 'append' && mode !== 'overwrite') {
      throw new BadRequestException('mode 必须是 append 或 overwrite');
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('文件内容为空，请检查文件后重新上传');
    }

    if (fileBuffer.length > 20 * 1024 * 1024) {
      throw new BadRequestException('文件大小超过 20MB 限制');
    }

    const tmpDir = tmpdir();
    const safeName = fileName.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    const tmpFile = path.join(
      tmpDir,
      `restaurants_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`,
    );

    try {
      fs.writeFileSync(tmpFile, fileBuffer);
    } catch (err) {
      this.logger.error(`Failed to write temp file: ${String(err)}`);
      throw new BadRequestException('文件保存失败，请稍后重试');
    }

    let rows: RawRow[] = [];

    try {
      rows = await this.parseXlsx(tmpFile);
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      this.logger.error(`Unexpected parse error: ${String(err)}`);
      throw new BadRequestException(
        `Excel 解析失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore cleanup errors
      }
    }

    if (rows.length === 0) {
      throw new BadRequestException('未解析到任何数据行，请检查文件是否有内容且首行为表头');
    }

    const unrecognizedColumns = this.getUnrecognizedColumns(rows);
    const total = rows.length;

    const insertValues: typeof restaurants.$inferInsert[] = [];
    let success = 0;
    let missingWebsite = 0;
    let missingEmail = 0;
    let missingPhone = 0;
    let rowErrors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const mapped = this.mapRowToInsert(row);

        if (!mapped.name || !String(mapped.name).trim()) {
          continue;
        }

        success += 1;

        if (!mapped.website || !String(mapped.website).trim()) {
          missingWebsite += 1;
        }
        if (!mapped.email || !String(mapped.email).trim()) {
          missingEmail += 1;
        }
        if (!mapped.phone || !String(mapped.phone).trim()) {
          missingPhone += 1;
        }

        insertValues.push({
          ...mapped,
          status: 'pending' as CompanyStatus,
          importBatchId: String(Date.now()),
          projectId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        rowErrors.push(`第 ${i + 2} 行：${msg}`);
        if (rowErrors.length >= 5) break;
      }
    }

    if (success === 0) {
      const detail = rowErrors.length > 0
        ? `（${rowErrors.join('；')}）`
        : '（所有行名称均为空）';
      throw new BadRequestException(`未能导入任何有效数据${detail}`);
    }

    try {
      if (mode === 'overwrite') {
        await this.db.transaction(async (tx) => {
          await tx.delete(restaurants).where(eq(restaurants.projectId, projectId));
          if (insertValues.length > 0) {
            await tx.insert(restaurants).values(insertValues);
          }
        });
      } else {
        if (insertValues.length > 0) {
          await this.db.insert(restaurants).values(insertValues);
        }
      }
    } catch (err) {
      this.logger.error(`Database insert failed: ${String(err)}`);
      throw new BadRequestException(
        `数据写入失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      total,
      success,
      missingWebsite,
      missingEmail,
      missingPhone,
      mode,
      unrecognizedColumns,
      rowErrors: rowErrors.length > 0 ? rowErrors : undefined,
    };
  }

  async updateEmail(
    id: string,
    data: UpdateEmailRequest,
  ): Promise<Company> {
    const updated = await this.db
      .update(restaurants)
      .set({
        emailSubject: data.subject,
        emailBody: data.body,
      })
      .where(eq(restaurants.id, id))
      .returning({ id: restaurants.id });

    if (updated.length === 0) {
      throw new NotFoundException('公司不存在');
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db
      .delete(restaurants)
      .where(eq(restaurants.id, id))
      .returning({ id: restaurants.id });

    if (deleted.length === 0) {
      throw new NotFoundException('公司不存在');
    }
  }

  async clearByProject(projectId: string): Promise<void> {
    await this.db.delete(restaurants).where(eq(restaurants.projectId, projectId));
  }

  async findDuplicates(projectId: string): Promise<DuplicateGroup[]> {
    const allRows = await this.db
      .select()
      .from(restaurants)
      .where(eq(restaurants.projectId, projectId));

    const companies: Company[] = allRows.map((r) => this.mapRowToCompany(r));

    // Build field-key → company indices maps
    const nameMap = new Map<string, number[]>();
    const emailMap = new Map<string, number[]>();
    const websiteMap = new Map<string, number[]>();

    for (let i = 0; i < companies.length; i += 1) {
      const c = companies[i];
      const nameKey = normalizeName(c.name);
      if (nameKey) {
        const arr = nameMap.get(nameKey) ?? [];
        arr.push(i);
        nameMap.set(nameKey, arr);
      }
      const emailKey = normalizeEmail(c.email);
      if (emailKey) {
        const arr = emailMap.get(emailKey) ?? [];
        arr.push(i);
        emailMap.set(emailKey, arr);
      }
      const websiteKey = normalizeWebsite(c.website);
      if (websiteKey) {
        const arr = websiteMap.get(websiteKey) ?? [];
        arr.push(i);
        websiteMap.set(websiteKey, arr);
      }
    }

    // Union-Find
    const parent: number[] = companies.map((_, idx: number) => idx);
    function find(x: number): number {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    function union(a: number, b: number): void {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    // Track which fields contributed to each group (by root)
    const rootMatchFields = new Map<number, Set<'name' | 'email' | 'website'>>();

    function unionGroup(
      indices: number[],
      field: 'name' | 'email' | 'website',
    ): void {
      if (indices.length < 2) return;
      const first = indices[0];
      for (let i = 1; i < indices.length; i += 1) {
        union(first, indices[i]);
      }
    }

    for (const indices of nameMap.values()) unionGroup(indices, 'name');
    for (const indices of emailMap.values()) unionGroup(indices, 'email');
    for (const indices of websiteMap.values()) unionGroup(indices, 'website');

    // After all unions, compute which fields each root group touched
    function addFieldToRoot(
      map: Map<string, number[]>,
      field: 'name' | 'email' | 'website',
    ): void {
      for (const indices of map.values()) {
        if (indices.length < 2) continue;
        const root = find(indices[0]);
        const set = rootMatchFields.get(root) ?? new Set();
        set.add(field);
        rootMatchFields.set(root, set);
      }
    }
    addFieldToRoot(nameMap, 'name');
    addFieldToRoot(emailMap, 'email');
    addFieldToRoot(websiteMap, 'website');

    // Build groups by root
    const rootToIndices = new Map<number, number[]>();
    for (let i = 0; i < companies.length; i += 1) {
      const root = find(i);
      const arr = rootToIndices.get(root) ?? [];
      arr.push(i);
      rootToIndices.set(root, arr);
    }

    const result: DuplicateGroup[] = [];
    for (const [root, indices] of rootToIndices) {
      if (indices.length < 2) continue;
      const fields = rootMatchFields.get(root);
      if (!fields || fields.size === 0) continue;

      const matchFields: ('name' | 'email' | 'website')[] = [
        'name', 'email', 'website',
      ].filter((f) => fields.has(f as 'name' | 'email' | 'website')) as (
        'name' | 'email' | 'website'
      )[];

      // Determine groupKey: first non-empty match value among all companies
      let groupKey = '';
      const rootCompany = companies[indices[0]];
      if (fields.has('name')) {
        groupKey = normalizeName(rootCompany.name) ?? '';
      }
      if (!groupKey && fields.has('email')) {
        groupKey = normalizeEmail(rootCompany.email) ?? '';
      }
      if (!groupKey && fields.has('website')) {
        groupKey = normalizeWebsite(rootCompany.website) ?? '';
      }

      result.push({
        groupKey: groupKey || `group-${root}`,
        matchFields,
        companies: indices.map((i: number) => companies[i]),
      });
    }

    return result;
  }

  async createLead(
    projectId: string,
    leadData: AutoImportLead,
  ): Promise<Company> {
    const insertValue: typeof restaurants.$inferInsert = {
      projectId,
      status: 'pending',
      name: leadData.name?.trim() || 'Unnamed',
      seqNo: leadData.seqNo ?? null,
      country: leadData.country?.trim() || null,
      address: leadData.address?.trim() || null,
      website: leadData.website?.trim() || null,
      phone: leadData.phone?.trim() || null,
      email: leadData.email?.trim() || null,
      verifyStatus: leadData.verifyStatus?.trim() || null,
      source: leadData.source?.trim() || null,
      latitude:
        leadData.latitude != null ? String(leadData.latitude) : null,
      longitude:
        leadData.longitude != null ? String(leadData.longitude) : null,
    };

    // Phone normalization
    if (insertValue.phone) {
      const normResult = normalizePhone(
        insertValue.phone,
        insertValue.country ?? null,
      );
      insertValue.normalizedPhone = normResult.normalizedPhone;
      insertValue.phoneType = normResult.phoneType;
      insertValue.normalizedWhatsappPhone = normResult.whatsappPhone;
    }

    const inserted = await this.db
      .insert(restaurants)
      .values(insertValue)
      .returning();

    return this.mapRowToCompany(inserted[0]);
  }

  getNormalizedLeadKeys(lead: AutoImportLead): {
    name: string | null;
    email: string | null;
    website: string | null;
  } {
    return {
      name: normalizeName(lead.name ?? null),
      email: normalizeEmail(lead.email ?? null),
      website: normalizeWebsite(lead.website ?? null),
    };
  }

  async batchDelete(projectId: string, ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) {
      return 0;
    }

    const deleted = await this.db
      .delete(restaurants)
      .where(
        and(
          eq(restaurants.projectId, projectId),
          inArray(restaurants.id, ids),
        ),
      )
      .returning({ id: restaurants.id });

    return deleted.length;
  }

  // --- Private helpers ---

  private async parseXlsx(filePath: string): Promise<RawRow[]> {
    const distScriptPath = path.join(__dirname, 'parse_xlsx.py');
    const sourceScriptPath = path.join(
      process.cwd(),
      'server',
      'modules',
      'restaurants',
      'parse_xlsx.py',
    );
    const scriptPath = fs.existsSync(distScriptPath)
      ? distScriptPath
      : sourceScriptPath;

    try {
      const { stdout, stderr } = await execFileAsync(
        'python3',
        [scriptPath, filePath],
        { timeout: 30000, maxBuffer: 50 * 1024 * 1024 },
      );

      if (stderr && stderr.trim()) {
        this.logger.warn(`Python script stderr: ${stderr.trim()}`);
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        return [];
      }

      return JSON.parse(trimmed) as RawRow[];
    } catch (err) {
      this.logger.error(`Failed to parse xlsx: ${String(err)}`);
      const errUnknown = err as unknown as { stderr?: string; message?: string };
      if (errUnknown.stderr) {
        const stderrMsg = errUnknown.stderr;
        throw new BadRequestException(
          `Excel 解析失败: ${stderrMsg || errUnknown.message || '未知错误'}`,
        );
      }
      throw new BadRequestException('Excel 解析失败');
    }
  }

  private mapRowToInsert(row: RawRow): typeof restaurants.$inferInsert {
    const result: Record<string, unknown> = {};

    for (const [rawHeader, value] of Object.entries(row)) {
      const normalized = normalizeHeader(rawHeader);
      const fieldName = NORMALIZED_HEADER_MAP[normalized];
      if (!fieldName) continue;
      if (value === null || value === undefined) {
        result[fieldName] = null;
      } else {
        result[fieldName] = value;
      }
    }

    // Normalize website URL
    if (result.website && typeof result.website === 'string') {
      let url = result.website.trim();
      if (url && !/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
      }
      result.website = url;
    }

    // Coerce numeric fields
    if (result.seqNo !== undefined && result.seqNo !== null) {
      const n = Number(result.seqNo);
      result.seqNo = Number.isFinite(n) ? n : null;
    }
    if (result.latitude !== undefined && result.latitude !== null) {
      const n = Number(result.latitude);
      result.latitude = Number.isFinite(n) ? String(n) : null;
    }
    if (result.longitude !== undefined && result.longitude !== null) {
      const n = Number(result.longitude);
      result.longitude = Number.isFinite(n) ? String(n) : null;
    }

    // Phone normalization
    const phoneVal = result.phone as string | null | undefined;
    const countryVal = result.country as string | null | undefined;
    if (phoneVal) {
      const normResult = normalizePhone(phoneVal, countryVal);
      result.normalizedPhone = normResult.normalizedPhone;
      result.phoneType = normResult.phoneType;
      result.normalizedWhatsappPhone = normResult.whatsappPhone;
    }

    return result as typeof restaurants.$inferInsert;
  }

  private getUnrecognizedColumns(rows: RawRow[]): string[] {
    if (rows.length === 0) return [];
    const headers = Object.keys(rows[0]);
    return headers.filter((h: string) => {
      const normalized = normalizeHeader(h);
      return !(normalized in NORMALIZED_HEADER_MAP);
    });
  }

  private mapRowToCompany(
    row: typeof restaurants.$inferSelect,
  ): Company {
    return {
      id: row.id,
      projectId: row.projectId ?? null,
      seqNo: row.seqNo ?? null,
      name: row.name,
      country: row.country ?? null,
      address: row.address ?? null,
      website: row.website ?? null,
      phone: row.phone ?? null,
      email: row.email ?? null,
      verifyStatus: row.verifyStatus ?? null,
      source: row.source ?? null,
      latitude: row.latitude != null ? Number(row.latitude) : null,
      longitude: row.longitude != null ? Number(row.longitude) : null,
      status: row.status as CompanyStatus,
      websiteSummary: row.websiteSummary ?? null,
      websiteLanguage: row.websiteLanguage ?? null,
      websiteBusinessType: row.websiteCuisine ?? null,
      websiteProducts: row.websiteFeatures ?? null,
      websiteScale: null,
      websiteCity: null,
      websiteHighlights: null,
      websiteImpression: null,
      websiteSizeImpression: null,
      websiteContactEmail: row.websiteContactEmail ?? null,
      websiteContactPhone: row.websiteContactPhone ?? null,
      websiteSocial: row.websiteSocial ?? null,
      websiteHours: row.websiteHours ?? null,
      analyzeError: row.analyzeError ?? null,
      emailSubject: row.emailSubject ?? null,
      emailBody: row.emailBody ?? null,
      emailSubjectLocal: row.emailSubjectLocal ?? null,
      emailBodyLocal: row.emailBodyLocal ?? null,
      emailLanguage: row.emailLanguage ?? null,
      generateError: row.generateError ?? null,
      whatsappPhone: row.whatsappPhone ?? null,
      whatsappMessage: row.whatsappMessage ?? null,
      whatsappMessageLocal: row.whatsappMessageLocal ?? null,
      importBatchId: row.importBatchId ?? null,
      isStarred: row.isStarred ?? false,
      contactStatus: (row.contactStatus as ContactStatus | null) ?? {},
      normalizedPhone: row.normalizedPhone ?? null,
      phoneType:
        (row.phoneType as 'mobile' | 'landline' | 'unknown' | null) ?? null,
      normalizedWhatsappPhone: row.normalizedWhatsappPhone ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
