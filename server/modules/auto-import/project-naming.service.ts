import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import { modelConfig } from '@server/database/schema';
import { postChatCompletions } from '@server/common/utils/ai-chat';

/**
 * 机器人推送时的项目自动命名。
 *
 * 背景（2026-11-08）：用户说「搜索塞尔维亚的 100 个模具工厂并推送给网站，建立新项目」，
 * 机器人把「推送给网站」里的「给网站」当成项目名传了过来，站点照单全收，
 * 于是项目列表出现一个叫「给网站」的项目。用户期望的是：AI 分析推送的线索内容，
 * 自动起一个像「塞尔维亚模具工厂 Top100」这样的名字。
 *
 * 策略：
 * 1. 先判断传入的名字是不是「指令残片」（给网站 / 新建项目 / 文件名 / 动词长句等）；
 *    正常的项目名一律原样保留，绝不改动已有命名习惯。
 * 2. 是残片（或机器人显式 autoName）→ 用站点自己配置的模型（每用户一行，
 *    沿用统一 AI 调用入口）根据线索样本生成名称；AI 不可用/超时/结果不合格
 *    时回退到「国家 + 企业名录（N 家）」的规则命名，绝不阻塞导入。
 */

interface AiConfig {
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
}

export interface LeadSample {
  name?: string | null;
  country?: string | null;
  website?: string | null;
}

@Injectable()
export class ProjectNamingService {
  private readonly logger = new Logger(ProjectNamingService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 判断是不是「指令残片」而不是真正的项目名（只拦明显无效的，宁可漏判不可误判） */
  isPlaceholderName(name: string | null | undefined): boolean {
    const n = String(name || '').trim();
    if (!n) return true;
    if (n.length < 2 || n.length > 60) return true;
    // 动作/目的地短语：给网站、推送到网站、发到系统、上传到平台、到站点里…
    if (
      /^(?:推送|发送|发|送|导入|上传|同步|传给|传到|提交到|给|到|往|至|在)?\s*(?:给|到|往)?\s*(?:网站|站点|站|系统|平台|后台|BD(?:邮件)?系统?|邮件系统|服务端)(?:上|里|中|内|那边)?$/i.test(
        n,
      )
    ) {
      return true;
    }
    // 纯指令词 / 占位名
    if (
      /^(?:新建|建立|创建|生成|开|开个|建个|新建项目|建立项目|新建的?项目|新项目|项目|这个项目|那个项目|它|以上|如下|无|未命名|untitled|new project|test|auto-created by auto-import)$/i.test(
        n,
      )
    ) {
      return true;
    }
    // 明显的动作句或 xlsx 文件名
    if (/(?:搜索|搜一下|查找|推送给|发送给|发送给|并|然后|建立新项目|帮我|请)/.test(n)) return true;
    if (/\.(?:xlsx|xls|csv|pdf|docx?)$/i.test(n)) return true;
    // 站点自动生成的代码（XX1234）不该当项目名
    if (/^[A-Z]{2}[0-9]{4}$/.test(n.toUpperCase())) return true;
    return false;
  }

  /** 生成项目名：AI 优先，规则兜底；永不抛异常 */
  async generateName(
    leads: LeadSample[],
    hint: string,
    userId: string,
  ): Promise<{ name: string; source: 'ai' | 'fallback' }> {
    const fallback = this.fallbackName(leads, hint);
    try {
      const config = await this.getAiConfig(userId);
      if (!config) {
        return { name: fallback, source: 'fallback' };
      }
      const name = await this.askAi(config, leads, hint);
      if (name) return { name, source: 'ai' };
    } catch (err: unknown) {
      this.logger.warn(
        `项目自动命名失败，使用规则兜底：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { name: fallback, source: 'fallback' };
  }

  /** 规则兜底：出现最多的国家/地区 + 条数 */
  private fallbackName(leads: LeadSample[], hint: string): string {
    const counts = new Map<string, number>();
    for (const l of leads) {
      const c = String(l?.country || '').trim();
      if (!c) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const n = leads.length;
    // 提示词里偶尔有可用的地名/行业词（不是残片时），作为补充
    const cleanHint = this.isPlaceholderName(hint) ? '' : String(hint || '').trim().slice(0, 24);
    if (cleanHint && !this.isPlaceholderName(cleanHint)) {
      return cleanHint.length <= 40 ? cleanHint : cleanHint.slice(0, 40);
    }
    return top ? `${top}企业名录（${n} 家）` : `企业名录（${n} 家）`;
  }

  /** 取该用户的 AI 配置；没有则回退全局行（那里也存着机器人密钥与出厂配置） */
  private async getAiConfig(userId: string): Promise<AiConfig | null> {
    const pick = async (where: ReturnType<typeof sql>): Promise<AiConfig | null> => {
      const rows = await this.db
        .select({
          apiBaseUrl: modelConfig.apiBaseUrl,
          apiKey: modelConfig.apiKey,
          modelName: modelConfig.modelName,
        })
        .from(modelConfig)
        .where(where)
        .limit(1);
      const r = rows[0];
      if (!r?.apiKey || !r.apiBaseUrl || !r.modelName) return null;
      return { apiBaseUrl: r.apiBaseUrl, apiKey: r.apiKey, modelName: r.modelName };
    };
    try {
      const own = await pick(
        sql`(${modelConfig.createdBy}).user_id = ${userId} AND ${modelConfig.apiKey} IS NOT NULL AND ${modelConfig.apiKey} <> ''`,
      );
      if (own) return own;
    } catch {
      /* 列/角色问题不该阻断导入 */
    }
    try {
      const globalRow = await pick(
        sql`${modelConfig.createdBy} IS NULL AND ${modelConfig.apiKey} IS NOT NULL AND ${modelConfig.apiKey} <> ''`,
      );
      if (globalRow) return globalRow;
    } catch {
      /* 继续最后一层回退 */
    }
    // 最后兜底：系统里任意一行已配置的模型。机器人导入的项目归属
    // 「最早的管理员」，他可能没在设置页填过自己的 Key；命名是系统级动作，
    // 用系统上已配好的模型即可，Key 只在服务端使用、不出现在任何响应里。
    try {
      return await pick(
        sql`${modelConfig.apiKey} IS NOT NULL AND ${modelConfig.apiKey} <> ''`,
      );
    } catch {
      return null;
    }
  }

  private async askAi(
    config: AiConfig,
    leads: LeadSample[],
    hint: string,
  ): Promise<string | null> {
    const sample = leads
      .slice(0, 12)
      .map((l, i) => {
        const bits = [
          String(l?.name || '').trim(),
          String(l?.country || '').trim(),
          String(l?.website || '').trim(),
        ].filter(Boolean);
        return `${i + 1}. ${bits.join(' | ')}`.slice(0, 160);
      })
      .filter(Boolean)
      .join('\n');
    if (!sample) return null;

    const usableHint = this.isPlaceholderName(hint) ? '（无）' : String(hint).slice(0, 120);
    const prompt = [
      '你是 BD 客户开发项目的命名助手。根据下面这批企业线索，给这个新项目起一个简短、具体的名称。',
      '',
      '要求：',
      '- 只输出名称本身，不要解释、不要引号、不要书名号、不要标点结尾、不要换行',
      '- 不超过 30 个字符；线索以中文为主就用中文，以英文为主就用英文',
      '- 必须体现「国家/地区 + 行业/品类」，例如「塞尔维亚模具工厂 Top100」「Serbia Poultry Farms」',
      '- 不要出现「名录.xlsx」「新建项目」「给网站」「企业名录（N 家）」这类无意义词',
      '- 不要编造线索里看不出来的行业',
      '',
      `共 ${leads.length} 家企业。线索样本：`,
      sample,
      '',
      `用户原始描述（可能是误抽取的碎片，仅供参考）：${usableHint}`,
    ].join('\n');

    const resp = await postChatCompletions(
      `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        model: config.modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 80,
        temperature: 0,
      },
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      { timeout: 15_000, label: 'project-naming' },
    );

    const raw = (resp.data as { choices?: { message?: { content?: string } }[] })
      ?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const name = String(raw)
      .trim()
      .split('\n')[0]
      .replace(/^["'「」《》\s]+|["'「」《》\s]+$/g, '')
      .replace(/^(?:项目名(?:称)?|名称|Project name|Name)\s*[:：]\s*/i, '')
      .trim();
    if (!name || name.length > 60 || this.isPlaceholderName(name)) return null;
    return name;
  }
}
