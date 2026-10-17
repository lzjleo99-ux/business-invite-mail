import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, asc, sql } from 'drizzle-orm';
import axios from 'axios';
import { spawn } from 'child_process';
import { modelConfig, projectMaterials } from '@server/database/schema';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';
import { MaterialBlobService } from './material-blob.service';

export interface EmailImageCandidate {
  materialId: string;
  fileName: string;
  description: string;
  /** 描述来源：vision=模型看图，fallback=OCR/文件名兜底 */
  source: 'vision' | 'fallback';
}

const VISION_DESC_PROMPT =
  'Describe this image in English for a product catalog entry: what the image shows, '
  + 'the key equipment/products/people visible, and any readable text. '
  + 'Maximum 60 words. Output plain text only, no markdown, no preamble.';

/** 视觉请求允许的最大原图体积（超过则先缩）。 */
const MAX_RAW_BYTES = 1.5 * 1024 * 1024;
/** 无缩图能力时 vision 允许的最大体积（超了直接放弃看图）。 */
const MAX_UNSCALED_BYTES = 3.5 * 1024 * 1024;
/** 缩图目标：最长边 1024、JPEG q80 —— 给描述看足够了。 */
const RESIZE_MAX_EDGE = 1024;

interface MaterialRow {
  id: string;
  fileName: string;
  fileType: string;
  contentSummary: string | null;
  parsedContent: string | null;
  imageDescription: string | null;
}

/**
 * 图片素材的 AI 视觉描述与缓存。
 *
 * 用途：生成邮件时让模型从项目图片里挑「真正贴合正文内容」的图（而不是随便一张）。
 * 描述缓存到 project_materials.image_description —— 每张图只算一次；
 * 进程内再挂一层 Promise 去重，批量生成并发触达同一张图时只发一次请求。
 *
 * Vision 能力探测：用户的模型配置未必支持图片输入（网关可能只挂了文本模型）。
 * 第一次真实描述请求即探测：返回 200 且有文本 → 支持；若 4xx/明确不支持图片
 * → 该 key 在本进程生命周期内标记为不支持，之后直接走兜底描述。
 *
 * 兜底描述（vision 不可用时）：文件名 + OCR 文本（上传图片素材时 tesseract
 * 已经跑过 OCR 存进 contentSummary/parsedContent）+ 所属项目语境。
 */
@Injectable()
export class ImageAnalysisService {
  private readonly logger = new Logger(ImageAnalysisService.name);
  private ensurePromise: Promise<void> | null = null;
  /** apiKey → 是否支持视觉请求（进程内缓存，避免每张图试错） */
  private readonly visionSupport = new Map<string, boolean>();
  /** materialId → 进行中的描述 Promise（并发去重） */
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly materialBlobs: MaterialBlobService,
  ) {}

  /** project_materials.image_description 列（平台管理的表，启动期幂等 ALTER 补齐）。 */
  private ensureColumn(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = runIdempotentMigration(
        this.db,
        'image_description 列迁移',
        async (run) => {
          await run(
            'ALTER TABLE project_materials ADD COLUMN IF NOT EXISTS image_description text',
          );
        },
      ).then((via) => {
        this.logger.log(`image_description 列已就绪（via ${via}）`);
      }).catch((err) => {
        this.ensurePromise = null;
        throw err;
      });
    }
    return this.ensurePromise;
  }

  /**
   * 取（必要时生成）一张图片素材的描述。非图片素材返回 null。
   * force=true 时忽略缓存重新分析（重新上传会走 force）。
   */
  async describeMaterial(
    materialId: string,
    userId: string,
    opts: { force?: boolean } = {},
  ): Promise<string | null> {
    await this.ensureColumn();
    const row = await this.getMaterial(materialId);
    if (!row || row.fileType !== 'image') return null;
    if (row.imageDescription && !opts.force) return row.imageDescription;

    const existing = this.inflight.get(materialId);
    if (existing) return existing;

    const task = this.analyzeAndCache(row, userId)
      .catch((err: unknown) => {
        this.logger.warn(
          `图片描述生成失败 ${row.fileName}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      })
      .finally(() => {
        this.inflight.delete(materialId);
      });
    this.inflight.set(materialId, task);
    return task;
  }

  /**
   * 邮件选图候选：项目下全部图片素材，描述就地补齐（无描述的先算）。
   * 按 sortOrder 取前 6 张，控制 prompt 体积。
   */
  async getEmailImageCandidates(
    projectId: string,
    userId: string,
  ): Promise<EmailImageCandidate[]> {
    await this.ensureColumn();
    const rows = (await this.db
      .select({
        id: projectMaterials.id,
        fileName: projectMaterials.fileName,
        fileType: projectMaterials.fileType,
        contentSummary: projectMaterials.contentSummary,
        parsedContent: projectMaterials.parsedContent,
        imageDescription: projectMaterials.imageDescription,
      })
      .from(projectMaterials)
      .where(eq(projectMaterials.projectId, projectId))
      .orderBy(asc(projectMaterials.sortOrder))) as MaterialRow[];

    const images = rows.filter((r) => r.fileType === 'image').slice(0, 6);
    const result: EmailImageCandidate[] = [];
    for (const img of images) {
      let description = img.imageDescription;
      let source: EmailImageCandidate['source'] = 'fallback';
      if (description) {
        source = description.startsWith('vision:') ? 'vision' : 'fallback';
      } else {
        const fresh = await this.describeMaterial(img.id, userId);
        if (fresh) {
          description = fresh;
          source = fresh.startsWith('vision:') ? 'vision' : 'fallback';
        }
      }
      if (description) {
        result.push({
          materialId: img.id,
          fileName: img.fileName,
          description: description.replace(/^(vision|fallback):/, '').slice(0, 400),
          source,
        });
      } else {
        // 连兜底描述都没有（例如 OCR 也没跑出来）——至少给个文件名让模型知道有这张图
        result.push({
          materialId: img.id,
          fileName: img.fileName,
          description: `(no description available; filename only: ${img.fileName})`,
          source: 'fallback',
        });
      }
    }
    return result;
  }

  private async getMaterial(materialId: string): Promise<MaterialRow | null> {
    const rows = (await this.db
      .select({
        id: projectMaterials.id,
        fileName: projectMaterials.fileName,
        fileType: projectMaterials.fileType,
        contentSummary: projectMaterials.contentSummary,
        parsedContent: projectMaterials.parsedContent,
        imageDescription: projectMaterials.imageDescription,
      })
      .from(projectMaterials)
      .where(eq(projectMaterials.id, materialId))
      .limit(1)) as MaterialRow[];
    return rows[0] ?? null;
  }

  /** 生成描述并写缓存。缓存值带 vision:/fallback: 前缀区分来源（读取时剥掉）。 */
  private async analyzeAndCache(row: MaterialRow, userId: string): Promise<string | null> {
    let description: string | null = null;
    try {
      description = await this.describeWithVision(row, userId);
    } catch (err: unknown) {
      this.logger.warn(
        `vision 描述失败（走兜底） ${row.fileName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!description) {
      description = this.buildFallbackDescription(row);
    }
    if (!description) return null;

    await this.db
      .update(projectMaterials)
      .set({ imageDescription: description })
      .where(eq(projectMaterials.id, row.id));
    return description;
  }

  /** 用用户配置的模型看图生成描述；模型不支持图片输入时抛错（由调用方兜底）。 */
  private async describeWithVision(row: MaterialRow, userId: string): Promise<string> {
    const config = await this.getModelConfig(userId);
    const supported = this.visionSupport.get(config.apiKey);
    if (supported === false) {
      throw new Error('该模型不支持图片输入（已知）');
    }

    const dataUrl = await this.buildImageDataUrl(row.id);
    const url = `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
    const response = await axios.post(
      url,
      {
        model: config.modelName,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_DESC_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.2,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        timeout: 120000,
      },
    ).catch((err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status && status >= 400 && status < 500) {
        // 4xx：极大概率是模型/网关不吃 image_url —— 记住这个结论
        this.visionSupport.set(config.apiKey, false);
        this.logger.warn(
          `模型 ${config.modelName} 视觉请求被拒（status ${status}），本进程内不再尝试看图`,
        );
      }
      throw err;
    });

    const content: unknown = response.data?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) {
      throw new Error('vision 返回内容为空（可能是推理模型只回了思考过程）');
    }
    this.visionSupport.set(config.apiKey, true);
    return 'vision:' + text.slice(0, 400);
  }

  /** blob → data URL；超过阈值先用容器里的 python3+PIL 缩图（缩不了且超 3.5MB 放弃）。 */
  private async buildImageDataUrl(materialId: string): Promise<string> {
    const blob = await this.materialBlobs.load(materialId);
    if (!blob) throw new Error('图片字节不存在');
    let { data, contentType } = blob;
    if (!/^image\//.test(contentType)) {
      contentType = 'image/png'; // 落库时按上传 mimetype，这里兜个底
    }

    if (data.length > MAX_RAW_BYTES) {
      const resized = await this.resizeViaPil(data);
      if (resized) {
        data = resized;
        contentType = 'image/jpeg';
      } else if (data.length > MAX_UNSCALED_BYTES) {
        throw new Error(
          `图片 ${(data.length / 1048576).toFixed(1)}MB 过大且容器内无 PIL 缩图能力，跳过看图`,
        );
      }
    }

    return `data:${contentType};base64,${data.toString('base64')}`;
  }

  /**
   * python3 + PIL 缩图：读 stdin 原始字节 → 最长边缩到 1024 → JPEG 输出 stdout。
   * PIL 不在（apt 包 python3-pil 未装/本机开发环境）返回 null，调用方自行降级。
   */
  private resizeViaPil(input: Buffer): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const script = `
import sys
try:
    from PIL import Image
except ImportError:
    sys.exit(3)
import io
img = Image.open(io.BytesIO(sys.stdin.buffer.read()))
img = img.convert('RGB')
w, h = img.size
edge = max(w, h)
if edge > ${RESIZE_MAX_EDGE}:
    scale = ${RESIZE_MAX_EDGE} / float(edge)
    img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
out = io.BytesIO()
img.save(out, 'JPEG', quality=80)
sys.stdout.buffer.write(out.getvalue())
`;
      const child = spawn('python3', ['-c', script], { stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let errText = '';
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.stderr.on('data', (c: Buffer) => { errText += String(c); });
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        const out = Buffer.concat(chunks);
        if (code === 0 && out.length > 0) resolve(out);
        else {
          this.logger.warn(`PIL 缩图失败（code ${code}）：${errText.split('\n')[0].slice(0, 120)}`);
          resolve(null);
        }
      });
      child.stdin.on('error', () => { /* EPIPE 时 close 会带非 0 */ });
      child.stdin.end(input);
    });
  }

  /** 兜底描述：文件名 + OCR 文本 + 项目语境。返回 null 表示什么都提取不到。 */
  private buildFallbackDescription(row: MaterialRow): string | null {
    const parts: string[] = [];
    const name = row.fileName.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[_-]+/g, ' ').trim();
    if (name) parts.push(`Image file "${name}"`);
    const ocr = (row.parsedContent || row.contentSummary || '').trim();
    if (ocr) {
      parts.push(`Text visible in the image (OCR): ${ocr.slice(0, 300)}`);
    }
    if (parts.length === 0) return null;
    return 'fallback:' + parts.join('; ').slice(0, 400);
  }

  private async getModelConfig(userId: string): Promise<{
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
  }> {
    const rows = await this.db
      .select()
      .from(modelConfig)
      .where(sql`(${modelConfig.createdBy}).user_id = ${userId}`)
      .limit(1);
    const row = rows[0];
    if (!row || !row.apiKey?.trim()) {
      throw new Error('未配置模型 API Key，无法分析图片');
    }
    return {
      apiBaseUrl: row.apiBaseUrl,
      apiKey: row.apiKey,
      modelName: row.modelName,
    };
  }
}
