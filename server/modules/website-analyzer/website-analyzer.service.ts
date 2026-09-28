import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, inArray } from 'drizzle-orm';
import axios, { type AxiosInstance } from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { restaurants, modelConfig } from '@server/database/schema';
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

@Injectable()
export class WebsiteAnalyzerService {
  private readonly logger = new Logger(WebsiteAnalyzerService.name);
  private readonly httpClient: AxiosInstance;
  private readonly MAX_TEXT_LENGTH = 10000;
  private readonly CONCURRENCY = 5;

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

  async analyzeCompany(companyId: string): Promise<Company> {
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
      const fetchResult = await this.fetchWebsiteContent(company.website);
      const extraction = await this.extractWithModel(
        fetchResult.content,
        company.name,
        fetchResult.method,
      );

      const updateData: Partial<typeof restaurants.$inferInsert> = {
        websiteSummary: extraction.description ?? null,
        websiteCuisine: extraction.businessType ?? null,
        websiteFeatures: extraction.mainProducts ?? null,
        websiteHours: extraction.hours ?? null,
        websiteContactEmail: extraction.email ?? null,
        websiteContactPhone: extraction.phone ?? null,
        websiteSocial: extraction.social ?? null,
        websiteLanguage: extraction.language ?? null,
        status: 'analyzed' as CompanyStatus,
        analyzeError: null,
      };

      if (extraction.email && !company.email) {
        updateData.email = extraction.email;
      }

      const updated = await this.db
        .update(restaurants)
        .set(updateData)
        .where(eq(restaurants.id, companyId))
        .returning();

      return this.toCompanyDto(updated[0]);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // 兜底：用 Excel 已有字段做一个基础分析，保证能继续生成邮件
      try {
        const fallbackExtraction = this.buildFallbackExtraction(company);
        const updateData: Partial<typeof restaurants.$inferInsert> = {
          websiteSummary: fallbackExtraction.description,
          websiteCuisine: fallbackExtraction.businessType,
          websiteFeatures: fallbackExtraction.mainProducts,
          websiteLanguage: fallbackExtraction.language,
          status: 'analyzed' as CompanyStatus,
          analyzeError: `网站抓取失败，已使用兜底信息：${errorMessage}`,
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
    companyIds?: string[],
    projectId?: string,
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
    void this.processBatch(targetIds);
    return { total };
  }

  private async processBatch(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += this.CONCURRENCY) {
      const chunk = ids.slice(i, i + this.CONCURRENCY);
      await Promise.all(
        chunk.map((id: string) =>
          this.analyzeCompany(id).catch((err: unknown) => {
            this.logger.error(
              `分析公司失败 ${id}`,
              err instanceof Error ? err.stack : String(err),
            );
          }),
        ),
      );
    }
  }

  private async fetchWebsiteContent(website: string): Promise<FetchResult> {
    const baseUrl = this.normalizeUrl(website);

    // Step 1: HTTP 抓取
    try {
      const content = await this.fetchWithHttp(baseUrl);
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
      const content = await this.analyzeWithScreenshot(baseUrl);
      if (content && content.length > 100) {
        return { content, method: 'screenshot' };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`截图视觉分析失败: ${msg}`);
    }

    // Step 4: 兜底——抛出异常，由上层 buildFallbackExtraction 处理
    throw new Error('网站抓取失败，无法访问该网站（已尝试HTTP/无头浏览器/截图分析）');
  }

  private async fetchWithHttp(baseUrl: string): Promise<string> {
    const pages = ['', '/about', '/contact', '/products', '/services', '/company'];
    const contents: string[] = [];

    for (const page of pages) {
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

  private async fetchWithHeadlessChrome(baseUrl: string): Promise<string> {
    const pages = ['', '/about', '/contact'];
    const contents: string[] = [];

    for (const page of pages) {
      try {
        const url = page ? this.joinUrl(baseUrl, page) : baseUrl;
        const { stdout, stderr } = await execFileAsync(
          'google-chrome',
          [
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
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
        void stderr;
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

  private async analyzeWithScreenshot(baseUrl: string): Promise<string> {
    const screenshotId = randomUUID();
    const screenshotPath = `/tmp/ws_snap_${screenshotId}.png`;

    try {
      await execFileAsync(
        'google-chrome',
        [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
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
      const analysis = await this.extractFromScreenshot(imageBase64, baseUrl);
      return analysis;
    } finally {
      fs.unlink(screenshotPath).catch(() => {});
    }
  }

  private async extractFromScreenshot(
    imageBase64: string,
    baseUrl: string,
  ): Promise<string> {
    const config = await this.getModelConfig();

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
  ): Promise<WebsiteExtraction> {
    const config = await this.getModelConfig();

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

  private async getModelConfig(): Promise<{
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
    temperature: number | null;
  }> {
    const rows = await this.db.select().from(modelConfig).limit(1);
    if (rows.length === 0) {
      throw new BadRequestException('请先在模型设置中配置 API');
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
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  analyzeRestaurant(id: string): Promise<Company> {
    return this.analyzeCompany(id);
  }
}
