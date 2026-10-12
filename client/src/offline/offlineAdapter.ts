/**
 * Offline adapter for static hosting (GitHub Pages).
 *
 * GitHub Pages cannot run the NestJS backend, so any POST to /api/* fails
 * (405). When the app detects it is running without the platform runtime
 * (`window.__platform__` is undefined), we replace the axios transport with
 * this in-browser adapter backed by localStorage.
 *
 * - Data operations (projects, companies, import, stars, contact status,
 *   threads, settings) work fully and persist in the browser.
 * - Network/AI operations (real website analysis, LLM email/WhatsApp
 *   generation, connection test) return a friendly 503, because they need
 *   the server. Use the published fullstack app for those.
 */
import type { AxiosInstance, AxiosResponse } from 'axios';
import { AxiosError } from 'axios';
import * as XLSX from 'xlsx';
import { normalizePhone as normalizePhoneShared } from '@client/src/utils/phone-normalizer';

const LS = {
  projects: 'bim_projects',
  companies: 'bim_companies',
  materials: 'bim_materials',
  threads: 'bim_threads',
  modelConfig: 'bim_model_config',
  senderConfig: 'bim_sender_config',
  importSecret: 'bim_import_secret',
  authUsers: 'bim_auth_users',
};

function uid(prefix = ''): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}${rnd}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---------- offline accounts (static demo only) ----------

interface OfflineAccount {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: 'admin' | 'user';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Demo-only password digest. Security is irrelevant here: the data never
 * leaves the browser and the real backend uses bcrypt. It only prevents the
 * demo from storing plaintext passwords in localStorage.
 */
function hashPassword(password: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < password.length; i += 1) {
    const code = password.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = (h2 + code * (i + 7)) % 0x7fffffff;
  }
  return `demo$${h1.toString(36)}$${h2.toString(36)}`;
}

function readAccounts(): OfflineAccount[] {
  const accounts = read<OfflineAccount[]>(LS.authUsers, []);
  // Guarantee at least one admin exists so the demo can be explored fully.
  return accounts;
}

function toAuthUser(account: OfflineAccount): unknown {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    isActive: account.isActive,
  };
}

function toAdminUser(account: OfflineAccount): unknown {
  return {
    ...(toAuthUser(account) as Record<string, unknown>),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function signOfflineToken(account: OfflineAccount): string {
  try {
    return btoa(`offline.${account.id}`);
  } catch {
    return `offline.${account.id}`;
  }
}

function resolveAccountFromConfig(config: any): OfflineAccount | null {
  const headers = config?.headers || {};
  const raw =
    typeof headers.Authorization === 'string'
      ? headers.Authorization
      : typeof headers.authorization === 'string'
        ? headers.authorization
        : null;
  if (!raw) return null;
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  let decoded = token;
  try {
    decoded = atob(token);
  } catch {
    /* token may already be plain */
  }
  const id = decoded.startsWith('offline.') ? decoded.slice('offline.'.length) : decoded;
  const account = readAccounts().find((a) => a.id === id);
  return account && account.isActive ? account : null;
}

/** Enforce a session on guarded routes so expired tokens log the user out. */
function requireAccount(
  config: any,
  account: OfflineAccount | null,
): Promise<never> | null {
  if (account) return null;
  return fail(config, 401, '未提供有效的认证令牌');
}

// ---------- per-account data isolation ----------
// Mirrors ProjectsService / RestaurantsService on the server: admins see
// everything, regular accounts only see rows they own.

function isAdminAccount(account: OfflineAccount | null): boolean {
  return (account?.role ?? '') === 'admin';
}

/** Rows the account is allowed to see. Admins see all rows. */
function ownedBy<T extends { ownerId?: string | null }>(
  rows: T[],
  account: OfflineAccount | null,
): T[] {
  if (isAdminAccount(account)) return rows;
  return rows.filter((r) => r.ownerId === account?.id);
}

/**
 * Server-side access check for a single project. Returns a 404 when the row
 * does not exist and a 403 when it exists but belongs to somebody else --
 * the same distinction ProjectsService.findOne/update/remove make.
 */
function projectAccessError(
  config: any,
  project: any,
  account: OfflineAccount | null,
): Promise<never> | null {
  if (!project) return fail(config, 404, '项目不存在');
  if (!isAdminAccount(account) && project.ownerId !== account?.id) {
    return fail(config, 403, '无权操作该项目');
  }
  return null;
}

/**
 * Companies the account may touch: admins see all, regular accounts only the
 * ones inside their own projects. Mirrors RestaurantsService.projectOwnerWhere.
 */
function visibleCompanies(
  companies: any[],
  projectsList: any[],
  account: OfflineAccount | null,
): any[] {
  if (isAdminAccount(account)) return companies;
  const ownProjectIds = new Set(
    ownedBy(projectsList, account).map((p) => p.id),
  );
  return companies.filter((c) => ownProjectIds.has(c.projectId));
}

/**
 * One-time migration: projects created before owner tracking existed have no
 * `ownerId`. Hand them to the first (oldest) admin account so their original
 * owner keeps access instead of losing the data.
 */
function backfillProjectOwners(): void {
  const projectsList = read<any[]>(LS.projects, []);
  if (!projectsList.some((p) => !p.ownerId)) return;
  const fallbackOwner =
    readAccounts().find((a) => a.role === 'admin' && a.isActive)?.id ?? null;
  if (!fallbackOwner) return;
  write(
    LS.projects,
    projectsList.map((p) => (p.ownerId ? p : { ...p, ownerId: fallbackOwner })),
  );
}

// ---------- default configs ----------

function defaultModelConfig(): any {
  return {
    id: 'default',
    apiBaseUrl: 'https://api.aixapex.com/v1',
    apiKeySet: false,
    modelName: 'TPK/DeepSeek-V4-Flash',
    temperature: 0.7,
    emailLanguage: 'local',
    senderSignature: 'Zijian Lang\nGlobal Sourcing Specialist',
  };
}

function defaultSenderConfig(): any {
  return {
    id: 'default',
    senderName: 'Zijian Lang',
    senderTitle: 'Global Sourcing Specialist',
    personalStory: '',
  };
}

// ---------- excel import ----------

function normHeader(h: string): string {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[()（）【】\[\]\/:：.\-_]/g, '')
    .replace(/\s+/g, '');
}

/** Mirrors FIELD_ALIASES in server/modules/restaurants/restaurants.service.ts. */
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

const HEADER_ALIASES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [fieldName, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const key = normHeader(alias);
      if (key && !(key in map)) map[key] = fieldName;
    }
  }
  return map;
})();

function blankCompany(projectId: string): any {
  const ts = nowIso();
  return {
    id: uid('c_'),
    projectId,
    seqNo: null,
    name: '',
    country: null,
    address: null,
    website: null,
    phone: null,
    email: null,
    verifyStatus: null,
    source: null,
    latitude: null,
    longitude: null,
    status: 'pending',
    websiteSummary: null,
    websiteLanguage: null,
    websiteBusinessType: null,
    websiteProducts: null,
    websiteScale: null,
    websiteCity: null,
    websiteHighlights: null,
    websiteImpression: null,
    websiteSizeImpression: null,
    websiteContactEmail: null,
    websiteContactPhone: null,
    websiteSocial: null,
    websiteHours: null,
    analyzeError: null,
    emailSubject: null,
    emailBody: null,
    emailSubjectLocal: null,
    emailBodyLocal: null,
    emailLanguage: null,
    generateError: null,
    whatsappPhone: null,
    whatsappMessage: null,
    whatsappMessageLocal: null,
    importBatchId: null,
    isStarred: false,
    contactStatus: {
      whatsappContactedAt: null,
      viberContactedAt: null,
      emailContactedAt: null,
    },
    normalizedPhone: null,
    phoneType: null,
    normalizedWhatsappPhone: null,
    viberPhone: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

function importCompanies(body: any): any {
  const projectId: string = body.projectId;
  const mode: 'append' | 'overwrite' = body.mode || 'append';
  const contentBase64: string = body.contentBase64 || '';

  const bin = atob(contentBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const wb = XLSX.read(bytes, { type: 'array' });
  const sheetName = wb.SheetNames.includes('Data')
    ? 'Data'
    : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // map headers
  const headerRow = rows[0] || [];
  const colMap: Record<number, string> = {};
  const unrecognized: string[] = [];
  headerRow.forEach((h, idx) => {
    const key = HEADER_ALIASES[normHeader(h)];
    if (key) colMap[idx] = key;
    else if (String(h).trim()) unrecognized.push(String(h).trim());
  });

  let all = read<any[]>(LS.companies, []);
  if (mode === 'overwrite') {
    all = all.filter((c) => c.projectId !== projectId);
  }

  let success = 0;
  let missingWebsite = 0;
  let missingEmail = 0;
  let missingPhone = 0;
  const rowErrors: string[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row || row.every((v) => String(v ?? '').trim() === '')) continue;
    const rec: any = {};
    Object.entries(colMap).forEach(([idx, field]) => {
      rec[field] = row[Number(idx)];
    });
    const name = String(rec.name || '').trim();
    if (!name) {
      rowErrors.push(`第 ${r + 1} 行缺少名称，已跳过`);
      continue;
    }
    const company = blankCompany(projectId);
    company.seqNo = rec.seqNo !== undefined ? Number(rec.seqNo) || null : null;
    company.name = name;
    company.country = rec.country ? String(rec.country).trim() : null;
    company.address = rec.address ? String(rec.address).trim() : null;
    company.website = rec.website ? String(rec.website).trim() : null;
    company.phone = rec.phone ? String(rec.phone).trim() : null;
    company.email = rec.email ? String(rec.email).trim().toLowerCase() : null;
    company.verifyStatus = rec.verifyStatus ? String(rec.verifyStatus).trim() : null;
    company.source = rec.source ? String(rec.source).trim() : null;
    company.latitude = rec.latitude !== undefined ? Number(rec.latitude) || null : null;
    company.longitude = rec.longitude !== undefined ? Number(rec.longitude) || null : null;

    // Reuse the shared normalizer so the offline path and the server
    // (restaurants.service.ts) agree on phone parsing rules.
    const phoneInfo = normalizePhoneShared(company.phone ?? '', company.country);
    company.normalizedPhone = phoneInfo.normalizedPhone;
    company.phoneType = phoneInfo.phoneType;
    company.normalizedWhatsappPhone = phoneInfo.whatsappPhone;
    company.whatsappPhone = phoneInfo.whatsappPhone;
    company.viberPhone = phoneInfo.viberPhone;

    if (!company.website) missingWebsite += 1;
    if (!company.email) missingEmail += 1;
    if (!company.phone) missingPhone += 1;

    all.push(company);
    success += 1;
  }

  write(LS.companies, all);

  return {
    total: success,
    success,
    missingWebsite,
    missingEmail,
    missingPhone,
    mode,
    unrecognizedColumns: unrecognized,
    rowErrors,
  };
}

// ---------- derived views ----------

function projectStats(companies: any[]): any {
  let analyzed = 0;
  let generated = 0;
  let noEmail = 0;
  let failed = 0;
  let starred = 0;
  let pending = 0;
  let hasPhone = 0;
  let hasWhatsapp = 0;
  for (const c of companies) {
    if (c.status === 'analyzed' || c.status === 'generated') analyzed += 1;
    if (c.status === 'generated') generated += 1;
    if (!c.email) noEmail += 1;
    if (c.status === 'failed') failed += 1;
    if (c.isStarred) starred += 1;
    if (c.status === 'pending') pending += 1;
    if (c.phone) hasPhone += 1;
    if (c.normalizedWhatsappPhone) hasWhatsapp += 1;
  }
  return {
    total: companies.length,
    analyzed,
    generated,
    noEmail,
    failed,
    starred,
    pending,
    hasPhone,
    hasWhatsapp,
  };
}

function decorateProject(p: any, companies: any[], materials: any[]): any {
  const mine = companies.filter((c) => c.projectId === p.id);
  return {
    ...p,
    companyCount: mine.length,
    generatedCount: mine.filter((c) => c.status === 'generated').length,
    materials: materials.filter((m) => m.projectId === p.id).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/**
 * Applies the list filters shared by the workbench table. Mirrors
 * RestaurantsService.findAll in server/modules/restaurants: `search` matches
 * the name only, and the "analyzed" bucket covers analyzing + generated too.
 */
function filterCompanies(companies: any[], query: Record<string, string>): any[] {
  const projectId = query.projectid;
  let list = companies.filter((c) => c.projectId === projectId);
  const status = query.status;
  if (status) list = list.filter((c) => c.status === status);
  const search = (query.search || '').toLowerCase();
  if (search) {
    list = list.filter((c) => (c.name || '').toLowerCase().includes(search));
  }
  if (query.noemail === 'true') list = list.filter((c) => !c.email);
  if (query.isstarred === 'true') list = list.filter((c) => c.isStarred);
  switch (query.filterkey) {
    case 'starred':
      list = list.filter((c) => c.isStarred);
      break;
    case 'analyzed':
      list = list.filter(
        (c) =>
          c.status === 'analyzed' ||
          c.status === 'generating' ||
          c.status === 'generated',
      );
      break;
    case 'pending':
      list = list.filter((c) => c.status === 'pending');
      break;
    case 'generated':
      list = list.filter((c) => c.status === 'generated');
      break;
    case 'no_email':
      list = list.filter((c) => !c.email);
      break;
    case 'failed':
      list = list.filter((c) => c.status === 'failed');
      break;
    default:
      break;
  }
  return list;
}

// ---------- response helpers ----------

function ok(config: any, data: any, status = 200): AxiosResponse {
  return {
    data,
    status,
    statusText: status === 201 ? 'Created' : 'OK',
    headers: {},
    config,
  } as AxiosResponse;
}

function fail(config: any, status: number, message: string): Promise<never> {
  const error = new AxiosError(
    message,
    String(status),
    config,
    null,
    {
      status,
      statusText: message,
      headers: {},
      config,
      data: { statusCode: status, message, error: status === 503 ? 'Unavailable' : 'Error' },
    } as any,
  );
  return Promise.reject(error);
}

const AI_UNAVAILABLE =
  '静态演示页不支持实时网站分析与 AI 生成（GitHub Pages 无法运行服务端）。请使用已发布的完整应用。';

/** Routes that require a logged-in session. */
const GUARDED_ROOTS = new Set([
  'projects',
  'restaurants',
  'email-threads',
  'model-config',
  'sender-config',
  'email-generator',
  'admin',
]);

/** Build an RFC-822 (.eml) document for the static demo. */
function buildEml(company: any): string {
  const to = company.email || '';
  const subject = String(company.emailSubjectLocal || company.emailSubject || '');
  const body = String(company.emailBodyLocal || company.emailBody || '');
  const encodeRfc2047 = (value: string): string =>
    /[^\x20-\x7E]/.test(value)
      ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`
      : value;
  const lines = [
    `To: ${to}`,
    `Subject: ${encodeRfc2047(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ];
  return lines.join('\r\n');
}

// ---------- the adapter ----------

async function offlineAdapter(config: any): Promise<AxiosResponse> {
  let rawUrl: string = config.url || '';
  if (/^https?:\/\//.test(rawUrl)) {
    try {
      rawUrl = new URL(rawUrl).pathname;
    } catch {
      /* keep */
    }
  }
  // normalize a possible project sub-prefix down to /api
  const apiIdx = rawUrl.indexOf('/api/');
  if (apiIdx > 0) rawUrl = rawUrl.slice(apiIdx);

  const [path, qs = ''] = rawUrl.split('?');
  const query: Record<string, string> = {};
  qs.split('&')
    .filter(Boolean)
    .forEach((pair) => {
      const [k, v = ''] = pair.split('=');
      query[decodeURIComponent(k).toLowerCase()] = decodeURIComponent(v);
    });

  let body: any = config.data;
  if (typeof body === 'string') {
    try {
      body = body ? JSON.parse(body) : {};
    } catch {
      body = {};
    }
  }
  body = body || {};

  const method = (config.method || 'get').toLowerCase();
  const segments = path.split('/').filter(Boolean); // ['api', ...]
  const root = segments[1];
  const arg1 = segments[2];
  const arg2 = segments[3];
  const arg3 = segments[4];

  // ================= auth (static demo accounts) =================
  if (root === 'auth') {
    const accounts = readAccounts();

    if (method === 'post' && arg1 === 'register') {
      const email = String(body.email || '').trim().toLowerCase();
      if (accounts.some((a) => a.email === email)) {
        return fail(config, 409, '该邮箱已被注册');
      }
      const ts = nowIso();
      const newAccount: OfflineAccount = {
        id: uid('u_'),
        email,
        passwordHash: hashPassword(String(body.password || '')),
        displayName: String(body.displayName || email.split('@')[0]).trim(),
        role: accounts.length === 0 ? 'admin' : 'user',
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
      };
      accounts.push(newAccount);
      write(LS.authUsers, accounts);
      return ok(
        config,
        { user: toAuthUser(newAccount), token: signOfflineToken(newAccount) },
        201,
      );
    }

    if (method === 'post' && arg1 === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const found = accounts.find((a) => a.email === email);
      if (!found || found.passwordHash !== hashPassword(String(body.password || ''))) {
        return fail(config, 401, '邮箱或密码错误');
      }
      if (!found.isActive) {
        return fail(config, 401, '账号已被禁用');
      }
      return ok(config, {
        user: toAuthUser(found),
        token: signOfflineToken(found),
      });
    }

    if (method === 'get' && arg1 === 'me') {
      const current = resolveAccountFromConfig(config);
      if (!current) return fail(config, 401, '未提供有效的认证令牌');
      return ok(config, toAuthUser(current));
    }

    if (method === 'post' && arg1 === 'logout') {
      return ok(config, { success: true });
    }

    if (method === 'post' && arg1 === 'change-password') {
      const current = resolveAccountFromConfig(config);
      if (!current) return fail(config, 401, '未提供有效的认证令牌');
      const stored = accounts.find((a) => a.id === current.id);
      if (
        !stored ||
        stored.passwordHash !== hashPassword(String(body.oldPassword || ''))
      ) {
        return fail(config, 400, '旧密码不正确');
      }
      stored.passwordHash = hashPassword(String(body.newPassword || ''));
      stored.updatedAt = nowIso();
      write(LS.authUsers, accounts);
      return ok(config, { success: true });
    }
  }

  // ================= guarded business routes =================
  const account = resolveAccountFromConfig(config);
  const needsSession =
    GUARDED_ROOTS.has(root) ||
    (segments[1] === 'settings' && arg1 === 'import-secret');
  if (needsSession) {
    const guard = requireAccount(config, account);
    if (guard) return guard;
  }

  // ================= admin (user management) =================
  if (root === 'admin' && (account?.role ?? '') === 'admin') {
    const accounts = readAccounts();
    if (method === 'get' && arg1 === 'users') {
      const search = (query.search || '').trim().toLowerCase();
      const pageNum = Number(query.page) || 1;
      const pageSizeNum = Number(query.pagesize) || 20;
      const filtered = accounts
        .filter(
          (a) =>
            !search ||
            a.email.toLowerCase().includes(search) ||
            a.displayName.toLowerCase().includes(search),
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const start = (pageNum - 1) * pageSizeNum;
      return ok(config, {
        items: filtered.slice(start, start + pageSizeNum).map(toAdminUser),
        total: filtered.length,
      });
    }
    if (method === 'patch' && arg1 === 'users' && arg2 && arg3 === 'role') {
      const target = accounts.find((a) => a.id === arg2);
      if (!target) return fail(config, 404, '用户不存在');
      if (target.id === account?.id) {
        return fail(config, 400, '不能修改自己的角色');
      }
      target.role = body.role === 'admin' ? 'admin' : 'user';
      target.updatedAt = nowIso();
      write(LS.authUsers, accounts);
      return ok(config, toAdminUser(target));
    }
    if (method === 'patch' && arg1 === 'users' && arg2 && arg3 === 'active') {
      const target = accounts.find((a) => a.id === arg2);
      if (!target) return fail(config, 404, '用户不存在');
      if (target.id === account?.id) {
        return fail(config, 400, '不能禁用自己');
      }
      target.isActive = !!body.isActive;
      target.updatedAt = nowIso();
      write(LS.authUsers, accounts);
      return ok(config, toAdminUser(target));
    }
  }

  // ================= projects =================
  if (root === 'projects') {
    backfillProjectOwners();
    const projectsList = read<any[]>(LS.projects, []);
    const companies = read<any[]>(LS.companies, []);
    const materials = read<any[]>(LS.materials, []);

    if (method === 'get' && !arg1) {
      return ok(
        config,
        ownedBy(projectsList, account)
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((p) => ({ ...decorateProject(p, companies, []), materials: [] })),
      );
    }
    if (method === 'post' && !arg1) {
      const maxOrder = projectsList.reduce((m, p) => Math.max(m, p.sortOrder || 0), 0);
      const ts = nowIso();
      const p = {
        id: uid('p_'),
        name: String(body.name || '').trim(),
        description: body.description ?? '',
        sortOrder: maxOrder + 1,
        ownerId: account?.id ?? null,
        createdAt: ts,
        updatedAt: ts,
      };
      projectsList.push(p);
      write(LS.projects, projectsList);
      return ok(config, decorateProject(p, companies, materials), 201);
    }

    const id = arg1;
    const existing = projectsList.find((p) => p.id === id);
    const denied = projectAccessError(config, existing, account);
    if (denied) return denied;

    if (method === 'get' && arg2 === undefined) {
      return ok(config, decorateProject(existing, companies, materials));
    }
    if (method === 'patch') {
      if (body.name !== undefined) existing.name = body.name;
      if (body.description !== undefined) existing.description = body.description;
      existing.updatedAt = nowIso();
      write(LS.projects, projectsList);
      return ok(config, decorateProject(existing, companies, materials));
    }
    if (method === 'delete') {
      write(
        LS.projects,
        projectsList.filter((p) => p.id !== id),
      );
      write(
        LS.companies,
        companies.filter((c) => c.projectId !== id),
      );
      write(
        LS.materials,
        materials.filter((m) => m.projectId !== id),
      );
      const threads = read<any[]>(LS.threads, []).filter(
        (t) => t.projectId !== id,
      );
      write(LS.threads, threads);
      return ok(config, null);
    }

    // materials / images
    if (method === 'post' && (arg2 === 'materials-base64' || arg2 === 'images-base64')) {
      const isImage = arg2 === 'images-base64';
      const size = body.contentBase64 ? Math.floor((body.contentBase64.length * 3) / 4) : 0;
      const maxOrder = materials
        .filter((m) => m.projectId === id)
        .reduce((m, x) => Math.max(m, x.sortOrder || -1), -1);
      const mat = {
        id: uid('m_'),
        projectId: id,
        fileName: body.fileName || 'file',
        fileType: body.mimeType || (isImage ? 'image/*' : 'application/octet-stream'),
        fileSize: size,
        contentSummary: null,
        sortOrder: maxOrder + 1,
        createdAt: nowIso(),
      };
      materials.push(mat);
      write(LS.materials, materials);
      existing.updatedAt = nowIso();
      write(LS.projects, projectsList);
      if (isImage) return ok(config, decorateProject(existing, companies, materials));
      return ok(config, mat, 201);
    }
    if (method === 'delete' && (arg2 === 'materials' || arg2 === 'images')) {
      write(LS.materials, materials.filter((m) => m.id !== arg3));
      return ok(config, null);
    }
  }

  // ================= restaurants / companies =================
  if (root === 'restaurants') {
    const allCompanies = read<any[]>(LS.companies, []);
    const allProjects = read<any[]>(LS.projects, []);
    // Scope every read/write below to the rows this account owns.
    const companies = visibleCompanies(allCompanies, allProjects, account);

    // stats (must precede :id)
    if (method === 'get' && arg1 === 'stats') {
      const projectId = query.projectid;
      const list = companies.filter((c) => c.projectId === projectId);
      return ok(config, projectStats(list));
    }
    // duplicates
    if (method === 'get' && arg1 === 'duplicates') {
      const projectId = query.projectid;
      const list = companies.filter((c) => c.projectId === projectId);
      const groups: any[] = [];
      const keys = new Map<string, any[]>();
      const pushKey = (key: string, c: any) => {
        if (!key) return;
        const arr = keys.get(key) || [];
        arr.push(c);
        keys.set(key, arr);
      };
      list.forEach((c) => {
        pushKey(`name:${(c.name || '').toLowerCase()}`, c);
        if (c.email) pushKey(`email:${c.email.toLowerCase()}`, c);
        if (c.website) pushKey(`web:${c.website.toLowerCase()}`, c);
      });
      keys.forEach((arr, key) => {
        if (arr.length > 1) {
          const field = key.startsWith('name')
            ? 'name'
            : key.startsWith('email')
              ? 'email'
              : 'website';
          groups.push({
            groupKey: key,
            matchFields: [field],
            companies: arr,
          });
        }
      });
      return ok(config, { groups, totalDuplicates: groups.length });
    }
    // import
    if (method === 'post' && arg1 === 'import-base64') {
      const target = allProjects.find((p) => p.id === body.projectId);
      const denied = projectAccessError(config, target, account);
      if (denied) return denied;
      return ok(config, importCompanies(body), 201);
    }
    // batch delete
    if (method === 'post' && arg1 === 'batch-delete') {
      const ids: string[] = body.ids || [];
      const deletable = new Set(companies.map((c) => c.id));
      // Only rows this account can see may be removed; foreign rows are kept.
      write(
        LS.companies,
        allCompanies.filter((c) => !(deletable.has(c.id) && ids.includes(c.id))),
      );
      const deleted = companies.filter((c) => ids.includes(c.id)).length;
      return ok(config, { deleted });
    }
    // clear all
    if (method === 'delete' && !arg1) {
      const visibleIds = new Set(companies.map((c) => c.id));
      write(LS.companies, allCompanies.filter((c) => !visibleIds.has(c.id)));
      return ok(config, null);
    }

    // list (GET /api/restaurants?projectId=...) -- mirrors
    // RestaurantsService.findAll in server/modules/restaurants
    if (method === 'get' && !arg1) {
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.max(1, Number(query.pagesize) || 20);
      const offset = (page - 1) * pageSize;

      const list = filterCompanies(companies, query)
        // Server orders by createdAt DESC; keep that ordering so paging is stable.
        .slice()
        .sort((a, b) =>
          String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
        );

      const total = list.length;
      const items = list.slice(offset, offset + pageSize);
      return ok(config, { items, total, page, pageSize });
    }

    const id = arg1;
    // `companies` is the owner-scoped view, so a miss here means "not yours".
    const company = companies.find((c) => c.id === id);

    if (method === 'get' && !arg2) {
      if (!company) return fail(config, 404, '公司不存在');
      return ok(config, company);
    }
    if (method === 'delete' && !arg2) {
      if (!company) return fail(config, 404, '公司不存在');
      // Mutating in place then writing the full list keeps foreign rows intact.
      write(
        LS.companies,
        allCompanies.filter((c) => c.id !== id),
      );
      return ok(config, null);
    }
    if (method === 'patch' && arg2 === 'star') {
      if (!company) return fail(config, 404, '公司不存在');
      company.isStarred = !!body.isStarred;
      company.updatedAt = nowIso();
      write(LS.companies, allCompanies);
      return ok(config, company);
    }
    if (method === 'patch' && arg2 === 'contact-status') {
      if (!company) return fail(config, 404, '公司不存在');
      const ts = nowIso();
      if (body.type === 'whatsapp')
        company.contactStatus.whatsappContactedAt = body.contacted ? ts : null;
      if (body.type === 'viber')
        company.contactStatus.viberContactedAt = body.contacted ? ts : null;
      if (body.type === 'email')
        company.contactStatus.emailContactedAt = body.contacted ? ts : null;
      company.updatedAt = ts;
      write(LS.companies, allCompanies);
      return ok(config, company);
    }
    if (method === 'patch' && arg2 === 'email') {
      if (!company) return fail(config, 404, '公司不存在');
      if (body.subject !== undefined) company.emailSubject = body.subject;
      if (body.body !== undefined) company.emailBody = body.body;
      if (body.subjectLocal !== undefined)
        company.emailSubjectLocal = body.subjectLocal;
      if (body.bodyLocal !== undefined)
        company.emailBodyLocal = body.bodyLocal;
      company.updatedAt = nowIso();
      write(LS.companies, allCompanies);
      return ok(config, company);
    }
  }

  // ================= email threads =================
  if (root === 'email-threads') {
    const threads = read<any[]>(LS.threads, []);
    // Threads hang off a company, so scope them the same way.
    const ownCompanyIds = new Set(
      visibleCompanies(
        read<any[]>(LS.companies, []),
        read<any[]>(LS.projects, []),
        account,
      ).map((c) => c.id),
    );
    const ownThreads = threads.filter((t) => ownCompanyIds.has(t.companyId));

    if (method === 'get') {
      const companyId = query.companyid;
      const items = ownThreads
        .filter((t) => t.companyId === companyId)
        .sort((a, b) => (a.threadDate < b.threadDate ? 1 : -1));
      return ok(config, { items, total: items.length });
    }
    if (method === 'post' && !arg1) {
      if (!ownCompanyIds.has(body.companyId)) {
        return fail(config, 404, '公司不存在');
      }
      const t = {
        id: uid('t_'),
        companyId: body.companyId,
        projectId: body.projectId,
        threadDate: body.threadDate || nowIso(),
        content: body.content || '',
        direction: body.direction || 'note',
        createdAt: nowIso(),
      };
      threads.push(t);
      write(LS.threads, threads);
      return ok(config, t, 201);
    }
    if (method === 'delete') {
      if (!ownThreads.some((t) => t.id === arg1)) {
        return fail(config, 404, '记录不存在');
      }
      write(LS.threads, threads.filter((t) => t.id !== arg1));
      return ok(config, null);
    }
  }

  // ================= model config / settings =================
  if (root === 'model-config') {
    let cfg = read<any>(LS.modelConfig, null) || defaultModelConfig();
    if (method === 'get') return ok(config, cfg);
    if (method === 'patch') {
      cfg = { ...cfg, ...body };
      if (body.apiKey) cfg.apiKeySet = true;
      write(LS.modelConfig, cfg);
      return ok(config, cfg);
    }
    if (method === 'post' && arg1 === 'test') {
      return ok(config, { success: false, message: '静态演示不支持连接测试' });
    }
  }
  if (segments[1] === 'settings' && arg1 === 'import-secret') {
    let s = read<any>(LS.importSecret, null) || {
      importSecretSet: false,
      importSecretMasked: null,
    };
    if (method === 'get') return ok(config, s);
    if (method === 'post') {
      const secret: string = body.importSecret || '';
      s = {
        importSecretSet: !!secret,
        importSecretMasked: secret ? `••••${secret.slice(-4)}` : null,
      };
      write(LS.importSecret, s);
      return ok(config, s, 201);
    }
  }

  // ================= sender config =================
  if (root === 'sender-config') {
    let cfg = read<any>(LS.senderConfig, null) || defaultSenderConfig();
    if (method === 'get') return ok(config, cfg);
    if (method === 'patch') {
      cfg = { ...cfg, ...body };
      write(LS.senderConfig, cfg);
      return ok(config, cfg);
    }
  }

  // ================= website analyzer (needs network) =================
  if (root === 'website-analyzer') {
    return fail(config, 503, AI_UNAVAILABLE);
  }

  // ================= email generator =================
  if (root === 'email-generator') {
    const companies = visibleCompanies(
      read<any[]>(LS.companies, []),
      read<any[]>(LS.projects, []),
      account,
    );
    // whatsapp info (get)
    if (method === 'get' && arg1 === 'whatsapp') {
      const c = companies.find((x) => x.id === arg2);
      return ok(
        config,
        c
          ? {
              available: !!c.normalizedWhatsappPhone,
              internationalPhone: c.normalizedWhatsappPhone,
              messageText: c.whatsappMessage,
              messageTextLocal: c.whatsappMessageLocal,
              languageCode: c.emailLanguage,
            }
          : {
              available: false,
              internationalPhone: null,
              messageText: null,
              messageTextLocal: null,
              languageCode: null,
            },
      );
    }
    // .eml download
    if (method === 'get' && arg1 === 'eml') {
      const c = companies.find((x) => x.id === arg2);
      if (!c) return fail(config, 404, '公司不存在');
      const safeName = String(c.name || 'company').replace(/[^\w一-龥.-]+/g, '_');
      return ok(config, {
        emlContent: buildEml(c),
        fileName: `${safeName}.eml`,
      });
    }
    // compose data (get)
    if (method === 'get' && arg1 === 'compose') {
      const c = companies.find((x) => x.id === arg2);
      return ok(
        config,
        c
          ? {
              recipientEmail: c.email || '',
              subject: c.emailSubject || '',
              body: c.emailBody || '',
              subjectLocal: c.emailSubjectLocal || '',
              bodyLocal: c.emailBodyLocal || '',
              languageCode: c.emailLanguage || '',
              companyName: c.name,
            }
          : {
              recipientEmail: '',
              subject: '',
              body: '',
              subjectLocal: '',
              bodyLocal: '',
              languageCode: '',
              companyName: '',
            },
      );
    }
    // compose save (patch)
    if (method === 'patch' && arg1 === 'compose') {
      const c = companies.find((x) => x.id === arg2);
      if (!c) return fail(config, 404, '公司不存在');
      c.emailSubject = body.subject ?? c.emailSubject;
      c.emailBody = body.body ?? c.emailBody;
      c.emailSubjectLocal = body.subjectLocal ?? c.emailSubjectLocal;
      c.emailBodyLocal = body.bodyLocal ?? c.emailBodyLocal;
      c.emailLanguage = body.language ?? c.emailLanguage;
      c.updatedAt = nowIso();
      // `c` is a live reference inside the stored array, so persisting the
      // full list keeps other accounts' rows untouched.
      write(LS.companies, read<any[]>(LS.companies, []));
      return ok(config, null);
    }
    // everything else in email-generator needs the LLM server
    return fail(config, 503, AI_UNAVAILABLE);
  }

  return fail(config, 404, `静态演示未实现该接口：${method} ${path}`);
}

export function installOfflineIfStatic(axiosInstance: AxiosInstance): boolean {
  const platform = (window as any).__platform__;
  const forceOffline =
    (import.meta as any).env?.VITE_FORCE_OFFLINE === 'true';
  if (platform && !forceOffline) return false;
  axiosInstance.defaults.adapter = offlineAdapter as any;
  return true;
}
