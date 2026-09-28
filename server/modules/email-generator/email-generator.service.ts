import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, isNotNull, inArray, asc, or, isNull, sql } from 'drizzle-orm';
import axios from 'axios';
import {
  restaurants,
  modelConfig,
  projects,
  projectMaterials,
  senderConfig,
} from '@server/database/schema';
import type {
  Company,
  CompanyStatus,
  GeneratedEmail,
  EmlDownloadResponse,
  WhatsAppInfo,
} from '@shared/api.interface';
import { generateEml } from '../../common/utils/eml-generator';

interface BilingualEmailResult {
  subjectLocal: string;
  bodyLocal: string;
  subjectEn: string;
  bodyEn: string;
  relevancePoints: string[];
}

interface BilingualWhatsAppResult {
  local: string;
  english: string;
}

@Injectable()
export class EmailGeneratorService {
  private readonly logger = new Logger(EmailGeneratorService.name);
  private readonly CONCURRENCY = 5;
  private readonly MODEL_TIMEOUT_MS = 180000;
  private readonly MAX_RETRIES = 1;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async generateEmail(companyId: string): Promise<GeneratedEmail> {
    const company = await this.getCompanyById(companyId);
    if (!company) {
      throw new BadRequestException('公司不存在');
    }

    await this.db
      .update(restaurants)
      .set({ status: 'generating' as CompanyStatus, generateError: null })
      .where(eq(restaurants.id, companyId));

    try {
      const config = await this.getModelConfig();
      const sender = await this.getSenderConfig();
      const projectContext = await this.getProjectContext(company.projectId);

      const languageCode = this.getLocalLanguageCode(company.country);

      const result = await this.callBilingualEmailModel({
        company,
        projectContext,
        sender,
        languageCode,
        config,
      });

      await this.db
        .update(restaurants)
        .set({
          emailSubject: result.subjectEn,
          emailBody: result.bodyEn,
          emailSubjectLocal: result.subjectLocal,
          emailBodyLocal: result.bodyLocal,
          emailLanguage: languageCode,
          status: 'generated' as CompanyStatus,
          generateError: null,
        })
        .where(eq(restaurants.id, companyId));

      return {
        subject: result.subjectEn,
        body: result.bodyEn,
        subjectLocal: result.subjectLocal,
        bodyLocal: result.bodyLocal,
        languageCode,
        summary: result.bodyEn.slice(0, 200),
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.db
        .update(restaurants)
        .set({
          status: 'analyzed' as CompanyStatus,
          generateError: errorMessage,
        })
        .where(eq(restaurants.id, companyId));
      throw new BadRequestException(errorMessage);
    }
  }

  async batchGenerate(companyIds?: string[], projectId?: string): Promise<{ total: number }> {
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
            eq(restaurants.status, 'analyzed' as CompanyStatus),
          ),
        );
      targetIds = rows.map((r: { id: string }) => r.id);
    } else {
      targetIds = [];
    }

    const total = targetIds.length;
    void this.processBatch(targetIds);
    return { total };
  }

  async getEml(companyId: string): Promise<EmlDownloadResponse> {
    const company = await this.getCompanyById(companyId);
    if (!company) {
      throw new BadRequestException('公司不存在');
    }
    if (!company.emailSubject || !company.emailBody) {
      throw new BadRequestException('邮件尚未生成');
    }

    const toEmail = company.websiteContactEmail || company.email || '';
    const sender = await this.getSenderConfig();
    const fromLine = sender.senderTitle
      ? `${sender.senderName} <${sender.senderName.toLowerCase().replace(/\s+/g, '.')}@example.com>`
      : sender.senderName;

    const emlContent = generateEml(
      toEmail,
      company.emailSubject,
      company.emailBody,
      fromLine,
    );

    const safeName = company.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    return {
      emlContent,
      fileName: `${safeName}_email.eml`,
    };
  }

  async getWhatsAppInfo(companyId: string): Promise<WhatsAppInfo> {
    const company = await this.getCompanyById(companyId);
    if (!company) {
      throw new BadRequestException('公司不存在');
    }

    const savedPhone = company.whatsappPhone ?? null;
    const savedMessage = company.whatsappMessage ?? null;
    const savedMessageLocal = company.whatsappMessageLocal ?? null;
    const savedLanguage = company.emailLanguage ?? null;

    if (savedPhone && savedMessage) {
      return {
        available: true,
        internationalPhone: savedPhone,
        messageText: savedMessage,
        messageTextLocal: savedMessageLocal,
        languageCode: savedLanguage,
      };
    }

    const phone = company.websiteContactPhone || company.phone;
    if (!phone) {
      return {
        available: false,
        internationalPhone: null,
        messageText: null,
        messageTextLocal: null,
        languageCode: null,
      };
    }

    const internationalPhone = this.normalizePhone(phone, company.country);
    if (!internationalPhone) {
      return {
        available: false,
        internationalPhone: null,
        messageText: null,
        messageTextLocal: null,
        languageCode: null,
      };
    }

    const messageText = savedMessage || this.buildWhatsAppMessage(company);
    return {
      available: true,
      internationalPhone,
      messageText,
      messageTextLocal: null,
      languageCode: null,
    };
  }

  async generateWhatsAppForCompany(companyId: string): Promise<WhatsAppInfo> {
    const company = await this.getCompanyById(companyId);
    if (!company) {
      throw new BadRequestException('公司不存在');
    }

    const phone = company.websiteContactPhone || company.phone;
    if (!phone) {
      throw new BadRequestException('公司没有可用的电话号码');
    }

    const internationalPhone = this.normalizePhone(phone, company.country);
    if (!internationalPhone) {
      throw new BadRequestException('电话号码无法格式化为国际号码');
    }

    const config = await this.getModelConfig();
    const sender = await this.getSenderConfig();
    const projectContext = await this.getProjectContext(company.projectId);

    const languageCode = this.getLocalLanguageCode(company.country);

    const result = await this.callWhatsAppModel({
      company,
      projectContext,
      sender,
      config,
      languageCode,
    });

    await this.db
      .update(restaurants)
      .set({
        whatsappPhone: internationalPhone,
        whatsappMessage: result.english,
        whatsappMessageLocal: result.local,
        emailLanguage: languageCode,
      } as Partial<typeof restaurants.$inferInsert>)
      .where(eq(restaurants.id, companyId));

    return {
      available: true,
      internationalPhone,
      messageText: result.english,
      messageTextLocal: result.local,
      languageCode,
    };
  }

  async batchPrepareWhatsApp(projectId: string): Promise<{ total: number }> {
    const rows = await this.db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(
        and(
          eq(restaurants.projectId, projectId),
          sql`(phone IS NOT NULL AND phone != '' OR website_contact_phone IS NOT NULL AND website_contact_phone != '')`,
        ),
      );
    const targetIds = rows.map((r: { id: string }) => r.id);
    const total = targetIds.length;
    void this.processBatchWhatsApp(targetIds);
    return { total };
  }

  async getCompose(companyId: string): Promise<{
    recipientEmail: string | null;
    subject: string;
    body: string;
    subjectLocal: string | null;
    bodyLocal: string | null;
    languageCode: string | null;
    companyName: string;
  }> {
    const company = await this.getCompanyById(companyId);
    if (!company) {
      throw new BadRequestException('公司不存在');
    }

    const recipientEmail =
      company.websiteContactEmail || company.email || null;

    return {
      recipientEmail,
      subject: company.emailSubject || '',
      body: company.emailBody || '',
      subjectLocal: company.emailSubjectLocal || null,
      bodyLocal: company.emailBodyLocal || null,
      languageCode: company.emailLanguage || null,
      companyName: company.name,
    };
  }

  async saveCompose(
    companyId: string,
    data: {
      subject: string;
      body: string;
      subjectLocal?: string;
      bodyLocal?: string;
      language: string;
    },
  ): Promise<void> {
    const company = await this.getCompanyById(companyId);
    if (!company) {
      throw new BadRequestException('公司不存在');
    }

    await this.db
      .update(restaurants)
      .set({
        emailSubject: data.subject,
        emailBody: data.body,
        emailSubjectLocal: data.subjectLocal ?? null,
        emailBodyLocal: data.bodyLocal ?? null,
        emailLanguage: data.language,
      })
      .where(eq(restaurants.id, companyId));
  }

  private async processBatchWhatsApp(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += this.CONCURRENCY) {
      const chunk = ids.slice(i, i + this.CONCURRENCY);
      await Promise.all(
        chunk.map((id: string) =>
          this.generateWhatsAppForCompany(id).catch((err: unknown) => {
            this.logger.error(
              `生成 WhatsApp 消息失败 ${id}`,
              err instanceof Error ? err.stack : String(err),
            );
          }),
        ),
      );
    }
  }

  private async processBatch(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += this.CONCURRENCY) {
      const chunk = ids.slice(i, i + this.CONCURRENCY);
      await Promise.all(
        chunk.map((id: string) =>
          this.generateEmail(id).catch((err: unknown) => {
            this.logger.error(
              `生成邮件失败 ${id}`,
              err instanceof Error ? err.stack : String(err),
            );
          }),
        ),
      );
    }
  }

  private async getCompanyById(id: string): Promise<typeof restaurants.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, id));
    return rows[0] ?? null;
  }

  private async getProjectContext(
    projectId: string | null,
  ): Promise<{ project: { name: string; description: string } | null; materials: string[] }> {
    if (!projectId) {
      return { project: null, materials: [] };
    }

    const projectRows = await this.db
      .select({ name: projects.name, description: projects.description })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const materialRows = await this.db
      .select({
        fileName: projectMaterials.fileName,
        fileType: projectMaterials.fileType,
        contentSummary: projectMaterials.contentSummary,
        parsedContent: projectMaterials.parsedContent,
      })
      .from(projectMaterials)
      .where(eq(projectMaterials.projectId, projectId))
      .orderBy(asc(projectMaterials.sortOrder));

    const materials = materialRows
      .map((m) => {
        const summary = m.parsedContent
          ? m.parsedContent.slice(0, 800)
          : m.contentSummary ?? '';
        return summary ? `[${m.fileName}]\n${summary}` : '';
      })
      .filter(Boolean);

    return {
      project: projectRows[0] ?? null,
      materials,
    };
  }

  private async getSenderConfig() {
    const rows = await this.db.select().from(senderConfig).limit(1);
    if (rows.length > 0) {
      return rows[0];
    }
    return {
      senderName: 'Zijian Lang',
      senderTitle: 'Global Sourcing Specialist',
      personalStory:
        '曾在英国 Cranfield University（位于米尔顿凯恩斯 Milton Keynes 附近）留学，对英国市场有深厚感情和深入了解，也因此更加珍惜每一次与英国企业合作的机会。',
    };
  }

  private getLocalLanguageCode(country: string | null): string {
    const c = (country || '').toLowerCase().trim();
    if (!c) return 'en';

    // Serbia
    if (c.includes('serbia') || c.includes('србија') || c.includes('srbija')) return 'sr';
    // France
    if (c.includes('france')) return 'fr';
    // Germany
    if (c.includes('germany') || c.includes('deutschland')) return 'de';
    // Italy
    if (c.includes('italy') || c.includes('italia')) return 'it';
    // Spain
    if (c.includes('spain') || c.includes('españa')) return 'es';
    // Netherlands
    if (c.includes('netherlands') || c.includes('nederland')) return 'nl';
    // Croatia
    if (c.includes('croatia') || c.includes('hrvatska')) return 'hr';
    // Bosnia
    if (c.includes('bosnia') || c.includes('bosna')) return 'bs';
    // UK
    if (
      c.includes('uk') ||
      c.includes('england') ||
      c.includes('united kingdom') ||
      c.includes('britain') ||
      c.includes('gb')
    ) return 'en';
    // USA
    if (
      c.includes('usa') ||
      c.includes('united states') ||
      c.includes('america')
    ) return 'en';
    // China
    if (c.includes('china') || c.includes('中国')) return 'zh';

    return 'en';
  }

  private getLanguageName(code: string): string {
    const names: Record<string, string> = {
      sr: 'Serbian',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      es: 'Spanish',
      nl: 'Dutch',
      hr: 'Croatian',
      bs: 'Bosnian',
      en: 'English',
      zh: 'Chinese',
    };
    return names[code] ?? 'English';
  }

  private isUKCompany(country: string | null): boolean {
    const c = (country || '').toLowerCase().trim();
    return (
      c.includes('uk') ||
      c.includes('england') ||
      c.includes('united kingdom') ||
      c.includes('britain') ||
      c.includes('scotland') ||
      c.includes('wales')
    );
  }

  private async callBilingualEmailModel(params: {
    company: typeof restaurants.$inferSelect;
    projectContext: { project: { name: string; description: string } | null; materials: string[] };
    sender: { senderName: string; senderTitle: string | null; personalStory: string | null };
    languageCode: string;
    config: {
      apiBaseUrl: string;
      apiKey: string;
      modelName: string;
      temperature: number | null;
    };
  }): Promise<BilingualEmailResult> {
    const { company, projectContext, sender, languageCode, config } = params;

    const langName = this.getLanguageName(languageCode);
    const isUK = this.isUKCompany(company.country);

    const systemPrompt = `You are a thoughtful business development professional writing highly personalized cold outreach emails. Your top priority is genuine relevance — not quantity of selling points.

CORE RULES (non-negotiable):
1. Pick ONE single most relevant alignment point between the recipient company and what we offer. Build the entire email around that one point. A second point is allowed ONLY if it directly reinforces the first, not if it introduces a separate angle.
2. No template structure. Every email must have a different opening, different paragraph flow, different closing. Some open with a direct observation, some with a question, some lead with context. Never follow a fixed 4-paragraph formula.
3. Vary sentence length. Mix short punchy sentences with longer explanatory ones. Occasional very short (3-8 word) sentences are encouraged — real people write that way.
4. No marketing buzzwords. Absolutely no: "best-in-class", "win-win", "revolutionary", "cutting-edge", "game-changing", "synergize", "leverage", "disrupt", "state-of-the-art". Use plain, credible language instead.
5. No generic openers. Never start with "I hope this email finds you well", "Hope you're doing well", "I trust you're having a great week", or any variation. Just start with the actual reason you're writing.
6. No fabricated facts. No made-up compliments about how "impressive" their company is. Only reference what you can verify from the provided data.
7. Length: 90-160 words total. Not shorter, not longer. Let length be determined by what needs to be said, not by a target word count.
8. Tone: professional but human. Write like a real person who's done their homework and genuinely thinks there might be a fit. Not like a sales script.
9. CTA should be natural and low-pressure. One brief sentence. Not a numbered list, not a hard sell.
10. ALWAYS end with a complete signature block: closing word, sender's full name on its own line, sender's job title on the next line.
11. Subject line: short (under 50 chars), specific to this company. No clickbait. Mention their company name or one specific detail.
12. Generate TWO complete, standalone versions: one in the local language, one in English. Both follow all the same rules.
13. Output ONLY valid JSON. No markdown, no commentary.`;

    const companyInfo = this.buildCompanyInfo(company);
    const projectInfo = this.buildProjectInfo(projectContext);
    const cityName = this.extractCityFallback(company);
    const seed = this.hashSeed(company.id);

    const ukNote = isUK && sender.personalStory
      ? `UK company note: You may naturally weave in one brief Cranfield University reference if it flows genuinely — the sender studied there. Keep it one short clause, not a paragraph. Never forced.`
      : `Do NOT mention Cranfield, UK study abroad, or any personal background story. No personal anecdotes at all.`;

    const styleVariants = [
      'Start with a direct observation about their business, then explain the fit in one paragraph, close with a soft CTA. 2-3 short paragraphs total.',
      'Open with a question or a specific detail you noticed about their company. Then introduce yourself and what you do. Keep it very tight.',
      'Lead with the value proposition in the first sentence. No preamble. Then back it up with one specific reason it applies to them. Short paragraphs.',
      "Start with context — who you are and why you're reaching out. Then zero in on one specific way your offering applies to their business. Casual-professional tone.",
      "Open with a very specific, verifiable observation about their company (from the data you have). Then pivot to why you're writing. Keep it brief and confident.",
    ];
    const styleHint = styleVariants[Math.floor(seed * styleVariants.length)];

    const userPrompt = `Write a cold outreach email for the company below. Generate TWO complete versions: one in ${langName} (local language, primary) and one in English. Both versions must be full, standalone emails.

## RECIPIENT COMPANY
${companyInfo}

City: ${cityName || 'unknown'}

## WHAT WE OFFER
${projectInfo}

## SENDER
Name: ${sender.senderName}
${sender.senderTitle ? `Title: ${sender.senderTitle}` : ''}

${ukNote}

## YOUR WRITING STYLE FOR THIS EMAIL
${styleHint}

## PROCESS (you must follow this)

Step 1: Find the SINGLE most relevant alignment point
- Look at what this company does (industry, products, scale, business model)
- Look at what we offer
- Pick the ONE most specific, concrete, relevant overlap point
- Do NOT pick 3-4 points and list them. One point only. Build the whole email around it.

Step 2: Write the email (both languages)
- Follow the writing style assigned above (different from a generic template)
- 90-160 words. Short paragraphs. Mix long and short sentences.
- No marketing language. No buzzwords. No generic greetings.
- Sound like a real person who did their research, not a sales automation tool.
- Subject line under 50 characters, specific to this company.
- Complete signature at the end (closing + name + title).

Step 3: Self-check before outputting
Run through this checklist. If any item fails, rewrite before returning:
- [ ] Does the email focus on ONE main point (not a list of features)?
- [ ] Is there at least one specific verifiable fact about the company mentioned (not generic praise)?
- [ ] Is the first sentence something OTHER than a generic greeting or "I hope this email finds you well" variant?
- [ ] Are there zero buzzwords (best-in-class, win-win, revolutionary, cutting-edge, etc.)?
- [ ] Is the tone natural — would a real person actually send this?
- [ ] Is the CTA low-pressure and brief (one sentence)?
- [ ] Is it between 90-160 words?
- [ ] Does it end with a proper signature (closing + name + title)?
- [ ] Does it read fluently with smooth, natural transitions and grammatically correct sentences (no awkward machine-translation phrasing, especially in the local-language version)?
- [ ] Is the logic coherent — a clear line from the opening observation to the single fit to the one ask, with no jumps or contradictions?

## LANGUAGE
- Local language version: ${langName} (primary — write this version first, then translate/adapt for English)
- English version: English

Return ONLY a JSON object with these exact keys:
- subject_local: subject line in ${langName}
- body_local: full email body in ${langName} (paragraphs separated by \n)
- subject_en: subject line in English
- body_en: full email body in English (paragraphs separated by \n)
- main_relevance_point: string — the single alignment point you chose to focus on
- self_check_passed: boolean — whether your final output passes the checklist`;

    const body: Record<string, unknown> = {
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config.temperature ?? 0.9,
      response_format: { type: 'json_object' },
    };

    const response = await this.callModelWithRetry(config, body);

    const contentStr = response.data?.choices?.[0]?.message?.content;
    if (!contentStr) {
      throw new Error('模型返回内容为空');
    }

    try {
      const parsed = JSON.parse(contentStr) as BilingualEmailResult & {
        relevance_points?: string[];
        subject_local?: string;
        body_local?: string;
        subject_en?: string;
        body_en?: string;
      };
      const result: BilingualEmailResult = {
        subjectLocal: parsed.subjectLocal ?? parsed.subject_local ?? '',
        bodyLocal: parsed.bodyLocal ?? parsed.body_local ?? '',
        subjectEn: parsed.subjectEn ?? parsed.subject_en ?? '',
        bodyEn: parsed.bodyEn ?? parsed.body_en ?? '',
        relevancePoints: parsed.relevancePoints ?? parsed.relevance_points ?? [],
      };
      const mainRp = (parsed as unknown as Record<string, unknown>).main_relevance_point;
      if (mainRp && typeof mainRp === 'string' && result.relevancePoints.length === 0) {
        result.relevancePoints = [mainRp];
      }
      if (!result.subjectLocal || !result.bodyLocal || !result.subjectEn || !result.bodyEn) {
        throw new Error('模型返回缺少双语字段');
      }
      return result;
    } catch {
      const match = contentStr.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as BilingualEmailResult & {
          subject_local?: string;
          body_local?: string;
          subject_en?: string;
          body_en?: string;
          relevance_points?: string[];
        };
        const result: BilingualEmailResult = {
          subjectLocal: parsed.subjectLocal ?? parsed.subject_local ?? '',
          bodyLocal: parsed.bodyLocal ?? parsed.body_local ?? '',
          subjectEn: parsed.subjectEn ?? parsed.subject_en ?? '',
          bodyEn: parsed.bodyEn ?? parsed.body_en ?? '',
          relevancePoints: parsed.relevancePoints ?? parsed.relevance_points ?? [],
        };
        const mainRp = (parsed as unknown as Record<string, unknown>).main_relevance_point;
        if (mainRp && typeof mainRp === 'string' && result.relevancePoints.length === 0) {
          result.relevancePoints = [mainRp];
        }
        if (!result.subjectLocal || !result.bodyLocal || !result.subjectEn || !result.bodyEn) {
          throw new Error('模型返回缺少双语字段');
        }
        return result;
      }
      throw new Error('无法解析模型返回的 JSON');
    }
  }

  private async callWhatsAppModel(params: {
    company: typeof restaurants.$inferSelect;
    projectContext: { project: { name: string; description: string } | null; materials: string[] };
    sender: { senderName: string; senderTitle: string | null; personalStory: string | null };
    config: {
      apiBaseUrl: string;
      apiKey: string;
      modelName: string;
      temperature: number | null;
    };
    languageCode: string;
  }): Promise<BilingualWhatsAppResult> {
    const { company, projectContext, sender, config, languageCode } = params;

    const langName = this.getLanguageName(languageCode);
    const isUK = this.isUKCompany(company.country);

    const systemPrompt = `You are a real person writing a short, casual instant message (the kind sent on WhatsApp or Viber) to reach out to someone at a company. This is NOT a formal email — it's a friendly, conversational text message you'd actually send to a stranger on a chat app.

RULES YOU MUST FOLLOW:
1. Super casual and human. Like a real person texting. Short sentences. Natural. Relaxed. Approachable. Not salesy. It must read like something typed on a phone, not copied from a brochure.
2. ONE single relevance point only. Don't list features or benefits. Just one reason they might care.
3. 30-50 words total. Short. Much shorter than an email. Real chat messages are brief.
4. No template openings. Don't start with "Hi there, hope you're well" or generic greetings. Just say something natural.
5. No marketing language. No buzzwords. No "best-in-class", "revolutionary", "win-win". Plain words only.
6. No fabricated facts. No fake compliments about how "great" their company is.
7. Casual sign-off. First name only, or nothing. Never "Best regards, Name, Title".
8. End with a relaxed, low-pressure question CTA — a simple "would you be open to a quick chat?" style, not a formal meeting request.
9. Write in a different style every time. Sometimes you start with the point directly. Sometimes with a brief intro. Mix it up.
10. Generate TWO versions: one in the local language and one in English. Both follow all the same rules and both must sound like fluent, native, colloquial speech.
11. Output ONLY valid JSON. No markdown, no commentary.`;

    const companyInfo = this.buildCompanyInfo(company);
    const projectInfo = this.buildProjectInfo(projectContext);
    const cityName = this.extractCityFallback(company);
    const seed = this.hashSeed(company.id);

    const ukNote = isUK && sender.personalStory
      ? 'UK company: a very subtle Cranfield reference is okay if it flows naturally, but keep it one short clause. Not a story.'
      : 'Do NOT mention Cranfield, UK study, or any personal story.';

    const waStyles = [
      "Direct style: open with the point, no preamble. Just say who you are and why you're messaging.",
      'Question-first style: open with a quick relevant question, then introduce yourself briefly.',
      'Context-first style: mention you came across their company, then say why you reached out. Relaxed.',
      'Casual-intro style: quick "hey" + your name + one sentence about why. Super brief.',
    ];
    const waStyleHint = waStyles[Math.floor(seed * waStyles.length)];

    const userPrompt = `Write a casual cold outreach instant message (for WhatsApp or Viber — same wording works on both) for the company below. Generate TWO versions: one in ${langName} (local language) and one in English. Both are standalone messages.

## RECIPIENT COMPANY
${companyInfo}

City: ${cityName || 'unknown'}

## WHAT WE OFFER
${projectInfo}

## SENDER
Name: ${sender.senderName}
${sender.senderTitle ? `Title: ${sender.senderTitle}` : ''}

${ukNote}

## WRITING STYLE FOR THIS MESSAGE
${waStyleHint}

## GUIDELINES
- Pick ONE most relevant point. One only. Build the whole message around it.
- 30-50 words. Short. Real people don't write long cold chat messages.
- Casual, relaxed and genuinely colloquial — contractions, the way someone actually texts. Not salesy. Not corporate. Not a mini-email.
- Mix of short and slightly longer sentences so it flows naturally when read aloud.
- No generic greetings. No "hope you're well". No weather.
- No buzzwords or marketing jargon.
- End with a relaxed question CTA. Something natural, not pushy.
- Sign off casually — first name only, or no sign-off if it flows.

## SELF-CHECK (rewrite if any fail)
- [ ] Only ONE relevance point (not a list)
- [ ] 30-50 words, not more
- [ ] No generic opener / no "hope you're well"
- [ ] Sounds like a real person texting, not a sales bot — fluent and colloquial in BOTH languages
- [ ] Casual, low-pressure CTA question at the end
- [ ] No formal signature block

## LANGUAGE
- Local language version: ${langName}
- English version: English

Return ONLY a JSON object with these exact keys:
- message_local: the full chat message in ${langName}
- message_en: the full chat message in English
- main_relevance_point: string — the single point you focused on
- self_check_passed: boolean`;

    const body: Record<string, unknown> = {
      model: config.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config.temperature ?? 0.7,
      response_format: { type: 'json_object' },
    };

    const response = await this.callModelWithRetry(config, body);

    const contentStr = response.data?.choices?.[0]?.message?.content;
    if (!contentStr) {
      throw new Error('模型返回内容为空');
    }

    try {
      const cleanContent = this.sanitizeJsonString(contentStr);
      const parsed = JSON.parse(cleanContent) as BilingualWhatsAppResult & {
        message_local?: string;
        message_en?: string;
      };
      const result: BilingualWhatsAppResult = {
        local: parsed.local ?? parsed.message_local ?? '',
        english: parsed.english ?? parsed.message_en ?? '',
      };
      if (!result.local || !result.english) {
        throw new Error('模型返回缺少双语 WhatsApp 字段');
      }
      return result;
    } catch {
      const match = contentStr.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const cleanContent = this.sanitizeJsonString(match[0]);
          const parsed = JSON.parse(cleanContent) as BilingualWhatsAppResult & {
            message_local?: string;
            message_en?: string;
          };
          const result: BilingualWhatsAppResult = {
            local: parsed.local ?? parsed.message_local ?? '',
            english: parsed.english ?? parsed.message_en ?? '',
          };
          if (!result.local || !result.english) {
            throw new Error('模型返回缺少双语 WhatsApp 字段');
          }
          return result;
        } catch {
          // 继续尝试更宽松的解析
        }
      }
      const fallback = this.tryLooseJsonParse(contentStr, ['message_local', 'local'], ['message_en', 'english']);
      if (fallback.local && fallback.english) return fallback as unknown as BilingualWhatsAppResult;
      throw new Error('无法解析模型返回的 JSON');
    }
  }

  private sanitizeJsonString(str: string): string {
    let result = str.trim();
    result = result.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    const braceStart = result.indexOf('{');
    const braceEnd = result.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
      result = result.slice(braceStart, braceEnd + 1);
    }
    return result
      .replace(/([{,])\s*(["']?)([\w_-]+)\2\s*:/g, '$1"$3":')
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/,\s*([}\]])/g, '$1');
  }

  private tryLooseJsonParse<T extends Record<string, string>>(
    content: string,
    localKeys: string[],
    englishKeys: string[],
  ): Partial<T> {
    const result: Record<string, string> = {};
    const allKeys = [...localKeys, ...englishKeys];
    for (const key of allKeys) {
      const patterns = [
        new RegExp(`"${key}"\s*:\s*"((?:[^"\\]|\\.)*)"`, 'i'),
        new RegExp(`"${key}"\s*:\s*'((?:[^'\\]|\\.)*)'`, 'i'),
        new RegExp(`${key}\s*:\s*"((?:[^"\\]|\\.)*)"`, 'i'),
      ];
      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          result[key] = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
          break;
        }
      }
    }
    const localVal = localKeys.map((k: string) => result[k]).find(Boolean) || '';
    const enVal = englishKeys.map((k: string) => result[k]).find(Boolean) || '';
    return { local: localVal, english: enVal } as unknown as Partial<T>;
  }

  private async callModelWithRetry(
    config: {
      apiBaseUrl: string;
      apiKey: string;
      modelName: string;
      temperature: number | null;
    },
    body: Record<string, unknown>,
  ) {
    const url: string = `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      try {
        const response = await axios.post(url, body, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          timeout: this.MODEL_TIMEOUT_MS,
        });
        return response;
      } catch (err: unknown) {
        lastError = err;
        const errObj = err as unknown as Record<string, unknown>;
        const isTimeout =
          err instanceof Error &&
          (err.message.includes('timeout') ||
            errObj.code === 'ECONNABORTED');
        const responseObj = errObj.response as Record<string, unknown> | undefined;
        const status = responseObj?.status != null ? Number(responseObj.status) : null;
        const is5xx = status != null && status >= 500;

        if (attempt < this.MAX_RETRIES && (isTimeout || is5xx)) {
          const waitMs: number = 2000 * (attempt + 1);
          this.logger.warn(
            `模型调用失败，${waitMs}ms 后重试（第 ${attempt + 1}/${this.MAX_RETRIES} 次）：${isTimeout ? 'timeout' : String(status ?? err)}`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  private buildCompanyInfo(
    company: typeof restaurants.$inferSelect,
  ): string {
    const lines: string[] = [];
    lines.push(`Company name: ${company.name}`);
    if (company.country) lines.push(`Country: ${company.country}`);
    if (company.address) lines.push(`Address: ${company.address}`);
    if (company.website) lines.push(`Website: ${company.website}`);
    if (company.websiteCuisine) lines.push(`Business type / industry: ${company.websiteCuisine}`);
    if (company.websiteFeatures) lines.push(`Main products or services: ${company.websiteFeatures}`);
    if (company.websiteSummary) lines.push(`Company description: ${company.websiteSummary}`);
    if (company.websiteHours) lines.push(`Working hours: ${company.websiteHours}`);
    if (company.websiteSocial) lines.push(`Social media: ${company.websiteSocial}`);
    if (company.email) lines.push(`Listed email: ${company.email}`);
    if (company.phone) lines.push(`Listed phone: ${company.phone}`);
    if (company.websiteContactEmail) lines.push(`Website contact email: ${company.websiteContactEmail}`);
    if (company.websiteContactPhone) lines.push(`Website contact phone: ${company.websiteContactPhone}`);
    // 新字段（website analyzer 后续会填）
    if ((company as Record<string, unknown>).websiteScale) {
      lines.push(`Company scale: ${String((company as Record<string, unknown>).websiteScale)}`);
    }
    if ((company as Record<string, unknown>).websiteImpression) {
      lines.push(`Website quality impression: ${String((company as Record<string, unknown>).websiteImpression)}`);
    }
    if ((company as Record<string, unknown>).websiteSizeImpression) {
      lines.push(`Company size impression: ${String((company as Record<string, unknown>).websiteSizeImpression)}`);
    }
    return lines.join('\n');
  }

  private buildProjectInfo(projectContext: {
    project: { name: string; description: string } | null;
    materials: string[];
  }): string {
    if (!projectContext.project) {
      return '(No project context available)';
    }
    const lines: string[] = [];
    lines.push(`Project: ${projectContext.project.name}`);
    lines.push(projectContext.project.description);
    if (projectContext.materials.length > 0) {
      lines.push('\nReference materials (key excerpts):');
      for (const m of projectContext.materials.slice(0, 3)) {
        lines.push(`- ${m}`);
      }
    }
    return lines.join('\n');
  }

  private hashSeed(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      const char = id.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash) / 2147483647;
  }

  private extractCityFallback(company: typeof restaurants.$inferSelect): string | null {
    if (company.address) {
      const parts = company.address.split(',').map((p: string) => p.trim()).filter(Boolean);
      if (parts.length >= 2) return parts[parts.length - 2];
      if (parts.length === 1) return parts[0];
    }
    return company.country;
  }

  private normalizePhone(phone: string, country: string | null): string | null {
    let digits = phone.replace(/\D/g, '');

    const lowerCountry = (country || '').toLowerCase();
    const isUK =
      lowerCountry.includes('uk') ||
      lowerCountry.includes('united kingdom') ||
      lowerCountry.includes('britain') ||
      lowerCountry.includes('england');
    const isSerbia = lowerCountry.includes('serbia');

    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    } else if (!digits.startsWith('44') && isUK) {
      digits = `44${digits.replace(/^0/, '')}`;
    } else if (!digits.startsWith('381') && isSerbia) {
      digits = `381${digits.replace(/^0/, '')}`;
    } else if (digits.startsWith('0') && lowerCountry) {
      digits = digits.replace(/^0/, '');
    }

    if (digits.length < 7 || digits.length > 15) return null;
    return digits;
  }

  private buildWhatsAppMessage(
    company: typeof restaurants.$inferSelect,
  ): string {
    const name = company.name;
    const body = company.emailBody || '';
    const paragraphs = body.split(/\n\n+/).filter(p => p.trim().length > 0);
    const pitchPara = paragraphs.length >= 2 ? paragraphs[1] : (paragraphs[0] || '');
    const cleanPitch = pitchPara.replace(/^Hi[^,]*[,—-]\s*/i, '').trim();

    const maxLength = 220;
    let shortPitch: string;

    if (cleanPitch.length <= maxLength) {
      shortPitch = cleanPitch;
    } else {
      const trimmed = cleanPitch.slice(0, maxLength);
      const sentenceEnd = Math.max(
        trimmed.lastIndexOf('. '),
        trimmed.lastIndexOf('.  '),
        trimmed.lastIndexOf('! '),
        trimmed.lastIndexOf('? '),
      );
      if (sentenceEnd >= 40) {
        shortPitch = trimmed.slice(0, sentenceEnd + 1);
      } else {
        const spaceIdx = trimmed.lastIndexOf(' ');
        shortPitch = spaceIdx > 20
          ? trimmed.slice(0, spaceIdx) + '.'
          : trimmed + '.';
      }
    }

    // Casual, channel-neutral fallback (used for both WhatsApp and Viber).
    // No formal signature and no stiff "15-min meeting" ask — reads like a text.
    return `Hi! I'm trying to reach the right person at ${name}.

${shortPitch}

Would you be open to a quick chat about it? No pressure at all. Thanks!`;
  }

  private async getModelConfig(): Promise<{
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
    temperature: number | null;
    emailLanguage: string;
    senderSignature: string;
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
      emailLanguage: row.emailLanguage,
      senderSignature: row.senderSignature,
    };
  }

  toCompanyDto(row: typeof restaurants.$inferSelect): Company {
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
      contactStatus: (row.contactStatus as unknown as Record<string, unknown> | null) ?? {},
      normalizedPhone: row.normalizedPhone ?? null,
      phoneType:
        (row.phoneType as 'mobile' | 'landline' | 'unknown' | null) ?? null,
      normalizedWhatsappPhone: row.normalizedWhatsappPhone ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
