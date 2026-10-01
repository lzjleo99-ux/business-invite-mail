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

const LS = {
  projects: 'bim_projects',
  companies: 'bim_companies',
  materials: 'bim_materials',
  threads: 'bim_threads',
  modelConfig: 'bim_model_config',
  senderConfig: 'bim_sender_config',
  importSecret: 'bim_import_secret',
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

// ---------- phone normalization (Serbia-focused, generic fallback) ----------

function normalizePhone(
  raw: string | null | undefined,
  country: string | null,
): { normalized: string | null; type: 'mobile' | 'landline' | 'unknown'; wa: string | null } {
  if (!raw) return { normalized: null, type: 'unknown', wa: null };
  let s = String(raw)
    .replace(/[^\d+]/g, '')
    .split(/[;,]/)[0];
  if (!s) return { normalized: null, type: 'unknown', wa: null };

  const isSerbia =
    (country || '').toLowerCase().includes('serbia') || s.includes('381');

  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);

  if (isSerbia) {
    if (s.startsWith('0')) s = `381${s.slice(1)}`;
    if (/^3816\d{6,8}$/.test(s)) {
      return { normalized: s, type: 'mobile', wa: s };
    }
    return { normalized: s, type: 'landline', wa: null };
  }

  return { normalized: s || null, type: 'unknown', wa: null };
}

// ---------- excel import ----------

function normHeader(h: string): string {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[()（）【】\[\]\/:：.\-_]/g, '')
    .replace(/\s+/g, '');
}

const HEADER_ALIASES: Record<string, string> = {
  序号: 'seqNo',
  no: 'seqNo',
  '#': 'seqNo',
  id: 'seqNo',
  名称: 'name',
  name: 'name',
  company: 'name',
  companyname: 'name',
  国家: 'country',
  国家地区: 'country',
  country: 'country',
  countryregion: 'country',
  地址: 'address',
  address: 'address',
  网站: 'website',
  website: 'website',
  url: 'website',
  web: 'website',
  电话: 'phone',
  phone: 'phone',
  tel: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  邮箱: 'email',
  email: 'email',
  mail: 'email',
  核验状态: 'verifyStatus',
  verification: 'verifyStatus',
  verify: 'verifyStatus',
  来源: 'source',
  source: 'source',
  sourcegooglemaps: 'source',
  纬度: 'latitude',
  lat: 'latitude',
  latitude: 'latitude',
  经度: 'longitude',
  lng: 'longitude',
  lon: 'longitude',
  longitude: 'longitude',
};

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

    const phoneInfo = normalizePhone(company.phone, company.country);
    company.normalizedPhone = phoneInfo.normalized;
    company.phoneType = phoneInfo.type;
    company.normalizedWhatsappPhone = phoneInfo.wa;
    company.whatsappPhone = phoneInfo.wa;

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

function filterCompanies(companies: any[], query: Record<string, string>): any[] {
  const projectId = query.projectid;
  let list = companies.filter((c) => c.projectId === projectId);
  const status = query.status;
  if (status) list = list.filter((c) => c.status === status);
  const search = (query.search || '').toLowerCase();
  if (search) {
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(search) ||
        (c.address || '').toLowerCase().includes(search) ||
        (c.email || '').toLowerCase().includes(search),
    );
  }
  if (query.noemail === 'true') list = list.filter((c) => !c.email);
  if (query.isstarred === 'true') list = list.filter((c) => c.isStarred);
  switch (query.filterkey) {
    case 'starred':
      list = list.filter((c) => c.isStarred);
      break;
    case 'analyzed':
      list = list.filter((c) => c.status === 'analyzed' || c.status === 'generated');
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

  // ================= projects =================
  if (root === 'projects') {
    const projectsList = read<any[]>(LS.projects, []);
    const companies = read<any[]>(LS.companies, []);
    const materials = read<any[]>(LS.materials, []);

    if (method === 'get' && !arg1) {
      return ok(
        config,
        projectsList
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
        createdAt: ts,
        updatedAt: ts,
      };
      projectsList.push(p);
      write(LS.projects, projectsList);
      return ok(config, decorateProject(p, companies, materials), 201);
    }

    const id = arg1;
    const existing = projectsList.find((p) => p.id === id);
    if (!existing) return fail(config, 404, '项目不存在');

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
    const companies = read<any[]>(LS.companies, []);

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
      return ok(config, importCompanies(body), 201);
    }
    // batch delete
    if (method === 'post' && arg1 === 'batch-delete') {
      const ids: string[] = body.ids || [];
      write(LS.companies, companies.filter((c) => !ids.includes(c.id)));
      return ok(config, { deleted: ids.length });
    }
    // clear all
    if (method === 'delete' && !arg1) {
      write(LS.companies, []);
      return ok(config, null);
    }

    const id = arg1;
    const company = companies.find((c) => c.id === id);

    if (method === 'get' && !arg2) {
      if (!company) return fail(config, 404, '公司不存在');
      return ok(config, company);
    }
    if (method === 'delete' && !arg2) {
      write(LS.companies, companies.filter((c) => c.id !== id));
      return ok(config, null);
    }
    if (method === 'patch' && arg2 === 'star') {
      if (!company) return fail(config, 404, '公司不存在');
      company.isStarred = !!body.isStarred;
      company.updatedAt = nowIso();
      write(LS.companies, companies);
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
      write(LS.companies, companies);
      return ok(config, company);
    }
    if (method === 'patch' && arg2 === 'email') {
      if (!company) return fail(config, 404, '公司不存在');
      if (body.subject !== undefined) company.emailSubject = body.subject;
      if (body.body !== undefined) company.emailBody = body.body;
      company.updatedAt = nowIso();
      write(LS.companies, companies);
      return ok(config, company);
    }
  }

  // ================= email threads =================
  if (root === 'email-threads') {
    const threads = read<any[]>(LS.threads, []);
    if (method === 'get') {
      const companyId = query.companyid;
      const items = threads
        .filter((t) => t.companyId === companyId)
        .sort((a, b) => (a.threadDate < b.threadDate ? 1 : -1));
      return ok(config, { items, total: items.length });
    }
    if (method === 'post' && !arg1) {
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
    const companies = read<any[]>(LS.companies, []);
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
      if (c) {
        c.emailSubject = body.subject ?? c.emailSubject;
        c.emailBody = body.body ?? c.emailBody;
        c.emailSubjectLocal = body.subjectLocal ?? c.emailSubjectLocal;
        c.emailBodyLocal = body.bodyLocal ?? c.emailBodyLocal;
        c.emailLanguage = body.language ?? c.emailLanguage;
        c.updatedAt = nowIso();
        write(LS.companies, companies);
      }
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
