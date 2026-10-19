import type { UserRole } from '@shared/api.interface';
import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, inArray, sql } from 'drizzle-orm';
import axios, { type AxiosInstance } from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { restaurants, modelConfig, projects, companyContacts } from '@server/database/schema';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';
import type { Company, CompanyStatus } from '@shared/api.interface';

const execFileAsync = promisify(execFile);

interface WebsiteExtraction {
  companyName?: string;
  businessType?: string;
  mainProducts?: string;
  description?: string;
  address?: string;
  city?: string;
  scale?: string;
  highlights?: string;
  hours?: string;
  email?: string;
  phone?: string;
  social?: string;
  language?: string;
  websiteImpression?: string;
  sizeImpression?: string;
}

interface FetchResult {
  content: string;
  method: 'http' | 'browser' | 'screenshot' | 'fallback';
  error?: string;
}

export interface EmailRescanChange {
  id: string;
  name: string;
  from: string | null;
  to: string;
  action: 'updated' | 'added';
}

export interface EmailRescanSummary {
  scanned: number;
  updated: number;
  added: number;
  errors: number;
  skippedNoWebsite: number;
  changes: EmailRescanChange[];
}

@Injectable()
export class WebsiteAnalyzerService {
  private readonly logger = new Logger(WebsiteAnalyzerService.name);
  private readonly httpClient: AxiosInstance;
  private readonly MAX_TEXT_LENGTH = 10000;
  private readonly chromeProfileDir = `/tmp/chrome-profile-${process.pid}`;
  private readonly CONCURRENCY = 5;
  private contactsTablePromise: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {
    this.httpClient = axios.create({
      timeout: 8000,
      maxRedirects: 5,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        DNT: '1',
        'Upgrade-Insecure-Requests': '1',
      },
      validateStatus: (status: number) => status >= 200 && status < 400,
    });
  }

  async analyzeCompany(companyId: string, userId: string): Promise<Company> {
    const [company] = await this.db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, companyId));

    if (!company) {
      throw new BadRequestException('公司不存在');
    }

    // 无网站：直接使用名称/地址做行业识别，走兜底分析路径（预期行为，不走 try/catch）
    if (!company.website) {
      const fallbackExtraction = this.buildFallbackExtraction(company);
      const updateData: Partial<typeof restaurants.$inferInsert> = {
        websiteSummary: fallbackExtraction.description,
        websiteCuisine: fallbackExtraction.businessType,
        websiteFeatures: fallbackExtraction.mainProducts,
        websiteLanguage: fallbackExtraction.language,
        status: 'analyzed' as CompanyStatus,
        analyzeError:
          'No website available — using name/address-based analysis',
      };
      const updated = await this.db
        .update(restaurants)
        .set(updateData)
        .where(eq(restaurants.id, companyId))
        .returning();
      return this.toCompanyDto(updated[0]);
    }

    await this.db
      .update(restaurants)
      .set({ status: 'analyzing' as CompanyStatus, analyzeError: null })
      .where(eq(restaurants.id, companyId));

    try {
      const fetchResult = await this.fetchWebsiteContent(company.website, userId, company.country);
      const extraction = await this.extractWithModel(
        fetchResult.content,
        company.name,
        fetchResult.method,
        userId,
      );

      // 多个邮箱/电话全部收集：模型给的主值 + 正文里正则扫到的全部（去重）。
      // 用户要求"有多个都要列出来"，单列 websiteContactEmail/Phone 存不下。
      const siteHost = (() => {
        try {
          return new URL(this.normalizeUrl(company.website)).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })();
      const modelEmail = (extraction.email ?? '').trim();
      const allEmails = this.rankEmails(
        Array.from(new Set([modelEmail, ...this.extractEmails(fetchResult.content)].filter(Boolean))),
        siteHost,
      );
      const modelPhone = (extraction.phone ?? '').trim();
      const allPhones = Array.from(
        new Set([modelPhone, ...this.extractPhones(fetchResult.content)].filter(Boolean)),
      );

      const updateData: Partial<typeof restaurants.$inferInsert> = {
        websiteSummary: extraction.description ?? null,
        websiteCuisine: extraction.businessType ?? null,
        websiteFeatures: extraction.mainProducts ?? null,
        websiteHours: extraction.hours ?? null,
        // 单列仍保留"最优那个"：发信/列宽/排序都依赖它
        websiteContactEmail: allEmails[0] ?? null,
        websiteContactPhone: allPhones[0] ?? null,
        websiteSocial: extraction.social ?? null,
        websiteLanguage: extraction.language ?? null,
        status: 'analyzed' as CompanyStatus,
        analyzeError: null,
      };

      const primaryEmail = allEmails[0];
      if (primaryEmail && !company.email) {
        updateData.email = primaryEmail;
      }

      const updated = await this.db
        .update(restaurants)
        .set(updateData)
        .where(eq(restaurants.id, companyId))
        .returning();

      await this.saveContacts(
        companyId,
        allEmails.map((v) => ({ type: 'email' as const, value: v })),
        allPhones.map((v) => ({ type: 'phone' as const, value: v })),
      );

      return this.toCompanyDto(updated[0]);
    } catch (error: unknown) {
      let errorMessage =
        error instanceof Error ? error.message : String(error);
      // 抓取成功但模型调用失败（典型：没配 API Key）时，不要把脏水泼到"抓取失败"上
      if (errorMessage.includes('请先在设置中配置你的 API Key')) {
        errorMessage = `网站内容已抓取，但 AI 分析失败：${errorMessage}`;
      } else if (!errorMessage.includes('抓取失败')) {
        errorMessage = `网站抓取失败：${errorMessage}`;
      }

      // 兜底：用 Excel 已有字段做一个基础分析，保证能继续生成邮件
      try {
        const fallbackExtraction = this.buildFallbackExtraction(company);
        const updateData: Partial<typeof restaurants.$inferInsert> = {
          websiteSummary: fallbackExtraction.description,
          websiteCuisine: fallbackExtraction.businessType,
          websiteFeatures: fallbackExtraction.mainProducts,
          websiteLanguage: fallbackExtraction.language,
          status: 'analyzed' as CompanyStatus,
          analyzeError: `${errorMessage}（已使用兜底信息）`,
        };
        const updated = await this.db
          .update(restaurants)
          .set(updateData)
          .where(eq(restaurants.id, companyId))
          .returning();
        return this.toCompanyDto(updated[0]);
      } catch {
        const updated = await this.db
          .update(restaurants)
          .set({
            status: 'failed' as CompanyStatus,
            analyzeError: errorMessage,
          })
          .where(eq(restaurants.id, companyId))
          .returning();
        if (updated && updated[0]) {
          return this.toCompanyDto(updated[0]);
        }
        const [fallback] = await this.db
          .select()
          .from(restaurants)
          .where(eq(restaurants.id, companyId));
        return this.toCompanyDto(fallback);
      }
    }
  }

  async batchAnalyze(
    companyIds: string[] | undefined,
    projectId: string | undefined,
    userId: string,
  ): Promise<{ total: number }> {
    let targetIds: string[];

    if (companyIds && companyIds.length > 0) {
      const rows = await this.db
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(inArray(restaurants.id, companyIds));
      targetIds = rows.map((r: { id: string }) => r.id);
    } else if (projectId) {
      const rows = await this.db
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(
          and(
            eq(restaurants.projectId, projectId),
            eq(restaurants.status, 'pending' as CompanyStatus),
          ),
        );
      targetIds = rows.map((r: { id: string }) => r.id);
    } else {
      const rows = await this.db
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(eq(restaurants.status, 'pending' as CompanyStatus));
      targetIds = rows.map((r: { id: string }) => r.id);
    }

    const total = targetIds.length;
    void this.processBatch(targetIds, userId);
    return { total };
  }

  private async processBatch(ids: string[], userId: string): Promise<void> {
    for (let i = 0; i < ids.length; i += this.CONCURRENCY) {
      const chunk = ids.slice(i, i + this.CONCURRENCY);
      await Promise.all(
        chunk.map((id: string) =>
          this.analyzeCompany(id, userId).catch((err: unknown) => {
            this.logger.error(
              `分析公司失败 ${id}`,
              err instanceof Error ? err.stack : String(err),
            );
          }),
        ),
      );
    }
  }

  private async fetchWebsiteContent(
    website: string,
    userId: string,
    country: string | null = null,
  ): Promise<FetchResult> {
    const baseUrl = this.normalizeUrl(website);
    // 本地语言栏目：英语 + 本地语言都要爬一遍再判断"有没有联系方式"
    const localPaths = this.localCrawlPaths(country);

    // Step 1: HTTP 抓取
    try {
      const content = await this.fetchWithHttp(baseUrl, localPaths);
      if (content && content.length > 500) {
        return { content, method: 'http' };
      }
      this.logger.warn(`HTTP 抓取内容过薄(${content?.length ?? 0}字)，疑似 JS 渲染，尝试浏览器渲染`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`HTTP 抓取失败: ${msg}，尝试浏览器渲染`);
    }

    // Step 2: 无头浏览器真实渲染（dump-dom = JS 渲染后的完整 DOM）
    try {
      const content = await this.fetchWithHeadlessChrome(baseUrl);
      if (content && content.length > 300) {
        return { content, method: 'browser' };
      }
      this.logger.warn('Chrome dump-dom 内容过少，尝试截图+视觉模型分析');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`无头浏览器渲染失败: ${msg}，尝试截图兜底`);
    }

    // Step 3: 截图 + 视觉模型分析（用于纯前端渲染、403 反爬页面）
    try {
      const content = await this.analyzeWithScreenshot(baseUrl, userId);
      if (content && content.length > 100) {
        return { content, method: 'screenshot' };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`截图视觉分析失败: ${msg}`);
    }

    // Step 4: 兜底——抛出异常，由上层 buildFallbackExtraction 处理。
    // 错误信息要能区分"网站真的访问不了"和"本部署环境没有可用的无头浏览器"，
    // 后者重试多少次都没用，别让用户白白重试。
    let browserNote = '';
    try {
      await this.findBrowserBinary();
    } catch {
      browserNote = '（本部署环境未安装可用的无头浏览器，JS 渲染页面无法分析）';
    }
    throw new Error(
      `网站抓取失败，无法访问该网站（已尝试 HTTP 直取${browserNote ? browserNote : '与无头浏览器/截图'}）`,
    );
  }

  /**
   * 按国家给出**本地语言**的常见栏目路径。
   * 只爬 /contact 这类英文路径会漏掉大量欧洲站点——塞尔维亚/德国/法国/意大利的
   * "联系我们"几乎都用本地词，用户明确要求"英语和本地语言都测试一遍"。
   */
  private localCrawlPaths(country: string | null): string[] {
    const c = (country || '').toLowerCase();
    const has = (...keys: string[]) => keys.some((k) => c.includes(k));

    if (has('serbia', 'srbija', 'србија', 'montenegro', 'croatia', 'bosnia', 'macedonia')) {
      return ['/kontakt', '/kontakti', '/o-nama', '/proizvodi', '/usluge', '/kontakt-2'];
    }
    if (has('germany', 'deutschland', 'austria', 'switzerland')) {
      return ['/kontakt', '/impressum', '/über-uns', '/produkte', '/leistungen'];
    }
    if (has('france')) {
      return ['/nous-contacter', '/a-propos', '/produits', '/services'];
    }
    if (has('italy', 'italia')) {
      return ['/contatti', '/chi-siamo', '/prodotti', '/servizi'];
    }
    if (has('spain', 'españa', 'espana')) {
      return ['/contacto', '/acerca-de', '/productos', '/servicios'];
    }
    if (has('netherlands', 'nederland', 'belgium', 'belgië', 'belgie')) {
      return ['/contact', '/over-ons', '/producten', '/diensten'];
    }
    if (has('poland', 'polska')) {
      return ['/kontakt', '/o-nas', '/produkty', '/uslugi'];
    }
    if (has('turkey', 'türkiye', 'turkiye')) {
      return ['/iletisim', '/hakkimizda', '/urunler', '/hizmetler'];
    }
    if (has('romania', 'românia')) {
      return ['/contact', '/despre-noi', '/produse', '/servicii'];
    }
    return [];
  }

  private async fetchWithHttp(baseUrl: string, localPaths: string[] = []): Promise<string> {
    // 首页 + 英文常见栏目 + **本地语言栏目**。
    // 本地语言路径很关键：塞尔维亚/德国/法国站点的"联系我们"很少用 /contact，
    // 常见 /kontakt（德/塞）、/nous-contacter（法）、/contatti（意）——
    // 只爬英文路径会漏掉整站唯一的联系方式。
    const pages = ['', '/about', '/contact', '/products', '/services', '/company', ...localPaths];
    const contents: string[] = [];
    const seen = new Set<string>();

    for (const page of pages) {
      if (seen.has(page)) continue;
      seen.add(page);
      try {
        const url = page ? this.joinUrl(baseUrl, page) : baseUrl;
        const response = await this.httpClient.get<string>(url, {
          responseType: 'text',
          headers: { Referer: baseUrl + '/' },
        });
        const contentType = String(response.headers['content-type'] ?? '');
        if (!contentType.includes('text/html')) {
          continue;
        }
        const text = this.extractText(response.data);
        if (text.trim().length > 0) {
          contents.push(`[${page || 'home'}]\n${text}`);
        }
      } catch (err: unknown) {
        if (page === '') {
          throw err;
        }
      }
    }

    const combined = contents.join('\n\n---\n\n');
    return combined.slice(0, this.MAX_TEXT_LENGTH);
  }


  /**
   * 依次尝试各平台可能的无头浏览器二进制名。
   * 注意：fs.access('chromium') 这类裸名字是按当前工作目录解析的、不走 PATH，
   * 必须自己拼 PATH 逐段探测（Docker 里 /usr/bin/chromium 就是这样被漏掉的）。
   */
  private async findBrowserBinary(): Promise<string> {
    const candidates = ['google-chrome', 'chromium', 'chromium-browser'];
    const { access } = await import('fs/promises');
    const dirs = (process.env.PATH || '').split(':').filter(Boolean);
    for (const bin of candidates) {
      for (const dir of dirs) {
        try {
          await access(`${dir}/${bin}`);
          return `${dir}/${bin}`;
        } catch {
          // 换下一个目录/候选
        }
      }
    }
    throw new Error(
      `未找到无头浏览器（尝试过 ${candidates.join(' / ')}），请先安装 chromium`,
    );
  }

  private async fetchWithHeadlessChrome(baseUrl: string): Promise<string> {
    const pages = ['', '/about', '/contact'];
    const contents: string[] = [];

    for (const page of pages) {
      try {
        const url = page ? this.joinUrl(baseUrl, page) : baseUrl;
        const { stdout, stderr } = await execFileAsync(
          await this.findBrowserBinary(),
          [
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
            // 容器兼容：小 /dev/shm、无 HOME、首次运行向导都会让 chromium 静默退出
            '--disable-dev-shm-usage',
            `--user-data-dir=${this.chromeProfileDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            '--dump-dom',
            '--virtual-time-budget=5000',
            '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            url,
          ],
          { timeout: 25000, maxBuffer: 5 * 1024 * 1024 },
        );
        const text = this.extractText(stdout);
        if (text.trim().length > 50) {
          contents.push(`[${page || 'home'}]\n${text}`);
        }
        if (stderr && stderr.trim()) {
          this.logger.warn(
            `Chrome dump-dom stderr: ${stderr.trim().slice(0, 300)}`,
          );
        }
      } catch (err: unknown) {
        if (page === '') {
          throw new Error(
            `Chrome headless failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    const combined = contents.join('\n\n---\n\n');
    return combined.slice(0, this.MAX_TEXT_LENGTH);
  }

  private async analyzeWithScreenshot(baseUrl: string, userId: string): Promise<string> {
    const screenshotId = randomUUID();
    const screenshotPath = `/tmp/ws_snap_${screenshotId}.png`;

    try {
      await execFileAsync(
        await this.findBrowserBinary(),
        [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          `--user-data-dir=${this.chromeProfileDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--hide-scrollbars',
          `--screenshot=${screenshotPath}`,
          '--window-size=1280,900',
          '--virtual-time-budget=5000',
          '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          baseUrl,
        ],
        { timeout: 25000 },
      );

      const stats = await fs.stat(screenshotPath);
      if (stats.size < 1000) {
        throw new Error('截图文件过小，可能渲染失败');
      }

      const imageBase64 = await fs.readFile(screenshotPath, { encoding: 'base64' });
      const analysis = await this.extractFromScreenshot(imageBase64, baseUrl, userId);
      return analysis;
    } finally {
      fs.unlink(screenshotPath).catch(() => {});
    }
  }

  private async extractFromScreenshot(
    imageBase64: string,
    baseUrl: string,
    userId: string,
  ): Promise<string> {
    const config = await this.getModelConfig(userId);

    const systemPrompt =
      'You are a web content analyzer. You are given a screenshot of a company website homepage. Describe what you see accurately and concisely. Focus on: company name, business type, products/services, contact info, visual quality, and overall impression.';

    const userPrompt = `Analyze this website screenshot and describe the company.

Website URL: ${baseUrl}

Provide:
- companyName: Full company/brand name you can see
- businessType: What industry/business they appear to be in (one short sentence)
- mainProducts: What products or services are visible (2-3 sentences)
- description: Brief summary of what the company does (under 150 words)
- visibleContact: Any email, phone, or social media links visible on screen
- websiteImpression: Your impression of the website quality
- sizeImpression: Company size impression based on the site
- language: Website language (english/serbian/chinese/other)

Return ONLY a valid JSON object with these fields.`;

    const body: Record<string, unknown> = {
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'low' },
            },
          ],
        },
      ],
      temperature: config.temperature ?? 0.3,
      response_format: { type: 'json_object' },
    };

    const response = await axios.post(
      `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        timeout: 60000,
      },
    );

    const contentStr = response.data?.choices?.[0]?.message?.content;
    if (!contentStr) {
      throw new Error('视觉模型返回内容为空');
    }

    try {
      const parsed = JSON.parse(contentStr) as Record<string, string>;
      const lines: string[] = [];
      if (parsed.companyName) lines.push(`Company name: ${parsed.companyName}`);
      if (parsed.businessType) lines.push(`Business type: ${parsed.businessType}`);
      if (parsed.mainProducts) lines.push(`Main products/services: ${parsed.mainProducts}`);
      if (parsed.description) lines.push(`Description: ${parsed.description}`);
      if (parsed.visibleContact) lines.push(`Contact info visible: ${parsed.visibleContact}`);
      if (parsed.websiteImpression) lines.push(`Website impression: ${parsed.websiteImpression}`);
      if (parsed.sizeImpression) lines.push(`Size impression: ${parsed.sizeImpression}`);
      if (parsed.language) lines.push(`Language: ${parsed.language}`);
      lines.push('[Extracted from website screenshot via vision model]');
      return lines.join('\n');
    } catch {
      return contentStr.slice(0, this.MAX_TEXT_LENGTH);
    }
  }

  private buildFallbackExtraction(
    company: typeof restaurants.$inferSelect,
  ): WebsiteExtraction & { isFallback: boolean } {
    const name = company.name;
    const country = company.country || 'the region';
    const city = company.address?.split(',').slice(-2, -1)[0]?.trim() || '';
    const lowerName = name.toLowerCase();
    const lowerAddress = (company.address || '').toLowerCase();
    const combined = lowerName + ' ' + lowerAddress;

    let businessType = 'Business company (website could not be analyzed)';
    let description = `${name} is a company based in ${city || country}. We were unable to access their website directly, so information is limited.`;

    // 行业关键词识别
    if (
      /\bchicken\b/.test(combined) ||
      /\bpoultry\b/.test(combined) ||
      /\bjaja\b/.test(combined) ||
      /\begg\b/.test(combined) ||
      /\bfarm\b/.test(combined)
    ) {
      businessType = 'Poultry farm / egg producer';
      description = `${name} appears to be engaged in poultry farming and egg production, based in ${city || country}. Information is inferred from the company name and address since no website is available.`;
    } else if (
      /\brestoran\b/.test(combined) ||
      /\brestaurant\b/.test(combined) ||
      /\bcafe\b/.test(combined) ||
      /\bbar\b/.test(combined)
    ) {
      businessType = 'Restaurant / food service';
      description = `${name} appears to be a restaurant or food service establishment in ${city || country}. Information is inferred from the company name and address since no website is available.`;
    }

    return {
      companyName: name,
      businessType,
      mainProducts:
        'Please refer to our project materials for proposed collaboration areas.',
      description,
      address: company.address ?? undefined,
      city: city || undefined,
      language: 'english',
      websiteImpression: 'Website could not be accessed',
      sizeImpression: 'Unknown',
      isFallback: true,
    };
  }

  private normalizeUrl(url: string): string {
    let result = url.trim();
    if (!result.startsWith('http://') && !result.startsWith('https://')) {
      result = 'https://' + result;
    }
    return result.replace(/\/+$/, '');
  }

  private joinUrl(base: string, path: string): string {
    return base + (path.startsWith('/') ? path : '/' + path);
  }

  private extractText(html: string): string {
    let text = html;
    const noisyTags = [
      'script',
      'style',
      'nav',
      'header',
      'footer',
      'noscript',
      'svg',
      'iframe',
    ];
    for (const tag of noisyTags) {
      const regex = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi');
      text = text.replace(regex, ' ');
    }
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  private async extractWithModel(
    content: string,
    companyName: string,
    fetchMethod: string,
    userId: string,
  ): Promise<WebsiteExtraction> {
    const config = await this.getModelConfig(userId);

    const systemPrompt =
      'You are a web content analyzer. Extract structured information from a company or organization website. Respond only with valid JSON. Be concise and accurate.';

    const userPrompt = `Extract structured information about the company "${companyName}" from the following website content.

Content source: ${fetchMethod} fetch

Extract these fields (only what you can find, leave empty if unknown):
- companyName: Full company/brand name
- businessType: Industry / business type (one short sentence)
- mainProducts: Key products or services (2-3 sentences)
- description: Brief company summary in under 200 words
- address: Full address if found
- city: City name only
- scale: Company scale (number of employees, offices, etc. — whatever is mentioned)
- highlights: 2-3 key selling points or strengths
- hours: Working / business hours
- email: Contact email address
- phone: Contact phone number
- social: Social media links (comma-separated)
- language: Website main language — one of: english, serbian, chinese, other
- websiteImpression: Your impression of the website quality (e.g., "professional and polished", "simple but functional", "outdated design") — be honest and brief
- sizeImpression: Your impression of company size based on the site (e.g., "small team / family business", "medium-sized company", "large enterprise")

Return ONLY a valid JSON object. No extra text.

Website content:
${content}`;

    const body: Record<string, unknown> = {
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config.temperature ?? 0.3,
      response_format: { type: 'json_object' },
    };

    const response = await axios.post(
      `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        timeout: 60000,
      },
    );

    const contentStr = response.data?.choices?.[0]?.message?.content;
    if (!contentStr) {
      throw new Error('模型返回内容为空');
    }

    try {
      const parsed = JSON.parse(contentStr) as WebsiteExtraction;
      return parsed;
    } catch {
      const match = contentStr.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]) as WebsiteExtraction;
      }
      throw new Error('无法解析模型返回的 JSON');
    }
  }

  private async getModelConfig(userId: string): Promise<{
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
    temperature: number | null;
  }> {
    const rows = await this.db
      .select()
      .from(modelConfig)
      .where(sql`(${modelConfig.createdBy}).user_id = ${userId}`)
      .limit(1);
    if (rows.length === 0) {
      throw new BadRequestException('请先在设置中配置你的 API Key');
    }
    // 空 key 直接给明确提示，避免把空 Bearer 发给模型服务换来一个看不懂的 401
    if (!rows[0].apiKey || !rows[0].apiKey.trim()) {
      throw new BadRequestException('请先在设置中配置你的 API Key');
    }
    const row = rows[0];
    return {
      apiBaseUrl: row.apiBaseUrl,
      apiKey: row.apiKey,
      modelName: row.modelName,
      temperature: row.temperature != null ? Number(row.temperature) : null,
    };
  }

  private toCompanyDto(row: typeof restaurants.$inferSelect): Company {
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
      whatsappPhone: (row as Record<string, unknown>).whatsappPhone as string | null ?? null,
      whatsappMessage: (row as Record<string, unknown>).whatsappMessage as string | null ?? null,
      whatsappMessageLocal: (row as Record<string, unknown>).whatsappMessageLocal as string | null ?? null,
      importBatchId: row.importBatchId ?? null,
      isStarred: Boolean((row as Record<string, unknown>).isStarred),
      contactStatus: ((row as Record<string, unknown>).contactStatus as Record<string, unknown> | null) ?? {},
      normalizedPhone: ((row as Record<string, unknown>).normalizedPhone as string | null) ?? null,
      phoneType: ((row as Record<string, unknown>).phoneType as 'mobile' | 'landline' | 'unknown' | null) ?? null,
      normalizedWhatsappPhone: ((row as Record<string, unknown>).normalizedWhatsappPhone as string | null) ?? null,
      viberPhone: ((row as Record<string, unknown>).normalizedPhone as string | null) ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  analyzeRestaurant(id: string, userId: string): Promise<Company> {
    return this.analyzeCompany(id, userId);
  }

  // ==================== 邮箱核验/挖掘（轻量，不走 AI） ====================
  //
  // 「一键分析全部」时对项目内所有公司重新扫官网：
  // - 已有邮箱的：核验是否还出现在官网上，出现其他更优邮箱则替换
  // - 没邮箱的：从官网（首页 + 联系页）挖邮箱
  // 只做 HTTP 抓取 + 正则提取，不调 AI —— 50 个站点约 1-2 分钟。

  async rescanProjectEmails(
    projectId: string,
    user: { userId: string; role: UserRole },
  ): Promise<EmailRescanSummary> {
    // 项目访问权：admin 全量，普通用户须是项目 owner（与 restaurants.findAll 同语义）
    if (user.role !== 'admin') {
      const owned = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, user.userId)))
        .limit(1);
      if (owned.length === 0) {
        throw new BadRequestException('项目不存在或无权访问');
      }
    }

    const companies = await this.db
      .select({
        id: restaurants.id,
        name: restaurants.name,
        website: restaurants.website,
        email: restaurants.email,
        websiteContactEmail: restaurants.websiteContactEmail,
      })
      .from(restaurants)
      .where(eq(restaurants.projectId, projectId));

    const withSite = companies.filter((c) => (c.website ?? '').trim().length > 0);
    const skippedNoWebsite = companies.length - withSite.length;

    const summary: EmailRescanSummary = {
      scanned: 0,
      updated: 0,
      added: 0,
      errors: 0,
      skippedNoWebsite,
      changes: [],
    };

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < withSite.length) {
        const company = withSite[cursor];
        cursor += 1;
        try {
          const action = await this.rescanCompanyEmail(company);
          summary.scanned += 1;
          if (action) {
            summary.changes.push(action);
            if (action.action === 'updated') summary.updated += 1;
            else summary.added += 1;
          }
          // null = kept（已有邮箱仍在官网）或 none（没挖到），不计入 changes
        } catch (err: unknown) {
          summary.scanned += 1;
          summary.errors += 1;
          this.logger.warn(
            `邮箱核验失败 ${company.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.CONCURRENCY, withSite.length) }, worker));

    return summary;
  }

  /**
   * 单公司邮箱核验。返回变更（updated/added）或 null（kept/none/error 已计入 summary）。
   * 规则：
   * - 官网（首页 + ≤3 个联系页）提取邮箱，按角色前缀/域名匹配排序取最优
   * - 已有邮箱且仍在官网出现 → 保持（kept）
   * - 已有邮箱但官网出现的是别的 → 替换 websiteContactEmail（updated，导入的 email 字段不动）
   * - 没邮箱且挖到 → 写 websiteContactEmail（email 为空时一并填，added）
   * - 什么都没挖到 → 保持现状（none），绝不因抓取失败清空已有邮箱
   */
  private async rescanCompanyEmail(company: {
    id: string;
    name: string;
    website: string;
    email: string | null;
    websiteContactEmail: string | null;
  }): Promise<{ id: string; name: string; from: string | null; to: string; action: 'updated' | 'added' } | null> {
    const siteRaw = company.website.trim();
    const siteUrl = /^https?:\/\//i.test(siteRaw) ? siteRaw : `https://${siteRaw}`;
    let siteHost = '';
    try {
      siteHost = new URL(siteUrl).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }

    const homepage = await this.fetchPageText(siteUrl);
    if (homepage === null) return null;

    const pages: string[] = [homepage];
    const contactLinks = this.extractContactLinks(homepage, siteUrl).slice(0, 2);
    for (const link of contactLinks) {
      const page = await this.fetchPageText(link);
      if (page !== null) pages.push(page);
      if (pages.length >= 3) break;
    }

    const found = this.rankEmails(
      pages.flatMap((p) => this.extractEmails(p)),
      siteHost,
    );
    if (found.length === 0) return null;

    const stored = (company.websiteContactEmail || company.email || '').trim().toLowerCase();
    const best = found[0];
    if (stored) {
      if (found.includes(stored)) return null; // kept：已有邮箱仍在官网上，可信
      if (best === stored) return null;
      await this.db
        .update(restaurants)
        .set({ websiteContactEmail: best })
        .where(eq(restaurants.id, company.id));
      return { id: company.id, name: company.name, from: stored || null, to: best, action: 'updated' };
    }
    // 没有邮箱 → 新增
    const updateData: Record<string, unknown> = { websiteContactEmail: best };
    if (!company.email) updateData.email = best;
    await this.db
      .update(restaurants)
      .set(updateData)
      .where(eq(restaurants.id, company.id));
    return { id: company.id, name: company.name, from: null, to: best, action: 'added' };
  }

  /** 轻量抓取：纯 HTTP、2MB 上限、8s 超时；任何失败返回 null（不抛）。 */
  private async fetchPageText(url: string): Promise<string | null> {
    try {
      const res = await this.httpClient.get<string>(url, {
        responseType: 'text',
        maxContentLength: 2 * 1024 * 1024,
        timeout: 8000,
      });
      const text = typeof res.data === 'string' ? res.data : '';
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  /** 从首页 HTML 里挖联系页链接（kontakt/contact/about/o nama/impressum 等），绝对化。 */
  private extractContactLinks(html: string, baseUrl: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const re = /<a\b[^>]*href\s*=\s*["']([^"'#\s]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && out.length < 4) {
      const href = m[1];
      const text = m[2].replace(/<[^>]*>/g, ' ').toLowerCase();
      if (!/kontakt|contact|about|onama|o-nama|impressum|info|联系|关于/i.test(href + ' ' + text)) continue;
      try {
        const abs = new URL(href, baseUrl).toString();
        // 只跟同站页面
        if (new URL(abs).hostname.replace(/^www\./, '') !== new URL(baseUrl).hostname.replace(/^www\./, '')) continue;
        if (seen.has(abs)) continue;
        seen.add(abs);
        out.push(abs);
      } catch {
        // 相对路径解析失败就跳过
      }
    }
    return out;
  }

  /** 从 HTML 提取邮箱：mailto: 优先，再全文正则；过滤垃圾与误报，去重小写。 */
  private extractEmails(html: string): string[] {
    const raw: string[] = [];
    const mailto = /mailto:([^\s'"?>\]>,]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = mailto.exec(html)) !== null) raw.push(m[1]);
    const plain = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
    while ((m = plain.exec(html)) !== null) raw.push(m[0]);

    const bad = /noreply|no-reply|donotreply|postmaster|abuse|spam|example\.(com|org)|sentry|wixpress|wix\.com|wordpress\.|godaddy|cloudflare|\.png|\.jpe?g|\.gif|\.webp|\.svg|\.css|\.js$/i;
    const out: string[] = [];
    const seen = new Set<string>();
    for (let item of raw) {
      item = item.trim().toLowerCase().replace(/[.,;:!'")\]]+$/, '');
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(item)) continue;
      if (item.length > 80) continue;
      if (bad.test(item)) continue;
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  }

  /**
   * 从 HTML 提取电话：优先 tel: 链接，再全文正则。
   * 欧洲站点同一个公司常有总机 + 传真 + 多个分部电话，全部保留给用户挑。
   * 过滤明显的年份/价格/尺寸误报。
   */
  private extractPhones(html: string): string[] {
    const raw: string[] = [];
    const tel = /tel:([^\s'"?>\]>,]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = tel.exec(html)) !== null) raw.push(m[1]);

    // 允许 + 开头、空格/短横/括号分隔；要求至少 6 位数字
    const plain = /\+?\d[\d\s().-]{5,20}\d/g;
    while ((m = plain.exec(html)) !== null) raw.push(m[0]);

    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const trimmed = item.trim().replace(/\s+/g, ' ');
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 20) continue;
      // 误报过滤：纯年份（如 2024）、价格、百分比、尺寸
      if (/^\d{4}$/.test(digits)) continue;
      if (/^[€$£¥]/.test(trimmed)) continue;
      if (/\d{4}\s*[x×]\s*\d{4}/i.test(trimmed)) continue;
      const key = digits; // 同一号码不同写法只留一个
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
      if (out.length >= 8) break;
    }
    return out;
  }

  /**
   * 覆盖式保存该公司抓到的全部联系方式（重新分析时先清掉旧的 website 来源）。
   * 表是自己建的，可以在请求期做 DDL（沿用 ddl-runner 幂等迁移）。
   */
  private async saveContacts(
    companyId: string,
    emails: { type: 'email'; value: string }[],
    phones: { type: 'phone'; value: string }[],
  ): Promise<void> {
    try {
      await this.ensureContactsTable();
      await this.db
        .delete(companyContacts)
        .where(
          and(
            eq(companyContacts.companyId, companyId),
            eq(companyContacts.source, 'website'),
          ),
        );
      const rows = [
        ...emails.map((e, i) => ({
          companyId,
          type: 'email' as const,
          value: e.value.slice(0, 320),
          source: 'website' as const,
          isPrimary: i === 0,
        })),
        ...phones.map((p, i) => ({
          companyId,
          type: 'phone' as const,
          value: p.value.slice(0, 320),
          source: 'website' as const,
          isPrimary: i === 0,
        })),
      ];
      if (rows.length > 0) await this.db.insert(companyContacts).values(rows);
      this.logger.log(
        `${companyId} 联系方式已保存：邮箱 ${emails.length} 个、电话 ${phones.length} 个`,
      );
    } catch (err: unknown) {
      // 明细表存不下不能影响主分析结果（单列已有最优值）
      this.logger.warn(
        `联系方式明细保存失败（不影响主流程）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 读某公司全部联系方式（展开行展示多个邮箱/电话） */
  async listContacts(companyId: string): Promise<
    { type: 'email' | 'phone'; value: string; isPrimary: boolean }[]
  > {
    try {
      await this.ensureContactsTable();
      const rows = await this.db
        .select()
        .from(companyContacts)
        .where(eq(companyContacts.companyId, companyId))
        .orderBy(companyContacts.isPrimary, companyContacts.createdAt);
      return rows.map((r) => ({
        type: r.type as 'email' | 'phone',
        value: r.value,
        isPrimary: r.isPrimary,
      }));
    } catch {
      return [];
    }
  }

  private async ensureContactsTable(): Promise<void> {
    if (!this.contactsTablePromise) {
      this.contactsTablePromise = runIdempotentMigration(
        this.db,
        'company_contacts',
        async (run) => {
          await run(`
            CREATE TABLE IF NOT EXISTS company_contacts (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              company_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
              type varchar(10) NOT NULL,
              value varchar(320) NOT NULL,
              source varchar(20) NOT NULL DEFAULT 'website',
              is_primary boolean NOT NULL DEFAULT false,
              _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`);
          await run(
            'CREATE INDEX IF NOT EXISTS idx_company_contacts_company ON company_contacts (company_id, type)',
          );
          await run(
            'GRANT ALL PRIVILEGES ON TABLE company_contacts TO anon_, authenticated_, service_role_',
          );
        },
      )
        .then(() => undefined)
        .catch((err: unknown) => {
          this.contactsTablePromise = null;
          throw err;
        });
    }
    return this.contactsTablePromise;
  }

  /**
   * 邮箱排序：角色前缀（info/office/kontakt/prodaja…）> 与站点同域名 > 其他；
   * 同分保持出现顺序（首页与 mailto 里的通常最相关）。
   */
  private rankEmails(emails: string[], siteHost: string): string[] {
    const role = /^(info|office|kontakt|contact|prodaja|sales|hello|pomoc|uprava|market[in]g|admin)\./i;
    const scored = emails.map((e, i) => {
      let score = 0;
      const local = e.split('@')[0];
      const domain = e.split('@')[1] ?? '';
      if (role.test(local)) score += 3;
      if (siteHost && (domain === siteHost || domain.endsWith(`.${siteHost}`))) score += 2;
      return { e, i, score };
    });
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.map((s) => s.e);
  }
}
