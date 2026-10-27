import type { UserRole } from '@shared/api.interface';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  Logger,
  UseGuards,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, IsOptional, MinLength } from 'class-validator';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { spawn } from 'child_process';
import { ProjectsService } from './projects.service';
import { MaterialBlobService } from './material-blob.service';
import { ImageAnalysisService } from './image-analysis.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-auth.guard';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const tesseract = require('tesseract.js');
import type {
  Project,
  ProjectMaterial,
  CreateProjectRequest,
  UpdateProjectRequest,
} from '@shared/api.interface';

interface FileUpload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

class CreateProjectDto implements CreateProjectRequest {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description!: string;
}

class UpdateProjectDto implements UpdateProjectRequest {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
  @IsOptional()
  @IsString()
  description?: string;
  /**
   * 项目网址（存 project_meta 表）。
   * DTO 里漏了这个字段 → ValidationPipe 的 whitelist 把它剥掉，
   * 服务端永远收不到网址 → 前端改完保存又变回去。
   * 允许空串（表示清空网址）。
   */
  @IsOptional()
  @IsString()
  website?: string;
}

class UploadMaterialByBase64Dto {
  @IsString()
  fileName!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsString()
  contentBase64!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('api/projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly materialBlobs: MaterialBlobService,
    private readonly imageAnalysis: ImageAnalysisService,
  ) {}

  /**
   * 图片素材上传成功后 fire-and-forget 预分析（vision 描述写入
   * image_description，供后续邮件选图直接读缓存）。
   * 失败只记日志：生成邮件时 getEmailImageCandidates 会兜底重算。
   */
  private scheduleImageAnalysis(materialId: string, userId: string, fileType: string): void {
    if (fileType !== 'image') return;
    void this.imageAnalysis.describeMaterial(materialId, userId).catch((err: unknown) => {
      this.logger.warn(
        `图片预分析失败 ${materialId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  @Get()
  async findAll(@CurrentUser() user: JwtPayload): Promise<Project[]> {
    return this.projectsService.findAll({ userId: user.userId, role: user.role });
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<Project> {
    return this.projectsService.findOne(id, { userId: user.userId, role: user.role });
  }

  @Post()
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<Project> {
    return this.projectsService.create(dto, { userId: user.userId, role: user.role });
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<Project> {
    return this.projectsService.update(id, dto, { userId: user.userId, role: user.role });
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.projectsService.remove(id, { userId: user.userId, role: user.role });
  }

  @Post(':id/materials')
  @UseInterceptors(FileInterceptor('file'))
  async addMaterial(
    @Param('id') id: string,
    @UploadedFile() file: FileUpload,
    @CurrentUser() user: JwtPayload,
  ): Promise<ProjectMaterial> {
    if (!file) {
      throw new BadRequestException('缺少文件');
    }
    // 统一 5MB 上限（所有上传入口一致）：超大文件解析会把容器 OOM 拖垮
    if (file.size > ProjectsController.MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `文件超过 5MB 限制（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩后上传`,
      );
    }

    const fileName: string = file.originalname;
    const fileType: string = this.detectFileType(file.mimetype, fileName);
    const fileSize: number = file.size;

    // 解析文件内容
    let parsedContent: string | null = null;
    try {
      parsedContent = await this.parseFileContent(file.buffer, fileType, fileName);
    } catch (err) {
      this.logger.warn(`文件解析失败 ${fileName}: ${String(err)}`);
    }
    // 双保险：解析失败的原始字节回退也在此净化（NUL/控制字符会让 INSERT 报 22021）
    parsedContent = this.sanitizeText(parsedContent);

    // 生成摘要（前 500 字，后续替换为 AI 摘要）
    const contentSummary: string | null = parsedContent
      ? parsedContent.slice(0, 500)
      : null;

    // 文件字节落库（自建部署无平台对象存储，见 MaterialBlobService 注释）
    const created = await this.projectsService.addMaterial(
      id,
      fileName,
      fileType,
      fileSize,
      '', // file_path 由 MaterialBlobService 写为 db:<id>
      contentSummary,
      parsedContent,
      { userId: user.userId, role: user.role },
    );
    await this.materialBlobs.save(created.id, file.buffer, file.mimetype || 'application/octet-stream');
    this.scheduleImageAnalysis(created.id, user.userId, fileType);
    return created;
  }

  /** 人工描述图片素材：写进描述表（manual: 前缀），生成邮件时优先生效、不再跑 AI 分析 */
  @Patch(':id/materials/:materialId/description')
  async setMaterialDescription(
    @Param('id') id: string,
    @Param('materialId') materialId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { description: string },
  ): Promise<{ ok: boolean }> {
    if (!body || typeof body.description !== 'string') {
      throw new BadRequestException('缺少 description');
    }
    await this.projectsService.setMaterialDescription(
      id, materialId, user.userId, body.description,
    );
    return { ok: true };
  }

  @Delete(':id/materials/:materialId')
  async removeMaterial(
    @Param('id') id: string,
    @Param('materialId') materialId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.projectsService.removeMaterial(id, materialId, { userId: user.userId, role: user.role });
  }

  @Post(':id/materials-base64')
  async addMaterialByBase64(
    @Param('id') id: string,
    @Body() dto: UploadMaterialByBase64Dto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ProjectMaterial> {
    if (!dto.contentBase64) {
      throw new BadRequestException('缺少文件内容');
    }
    const base64Clean = dto.contentBase64.includes(',')
      ? dto.contentBase64.split(',')[1]
      : dto.contentBase64;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Clean, 'base64');
    } catch (err) {
      throw new BadRequestException('文件内容格式错误，无法解析 base64');
    }
    if (buffer.length === 0) {
      throw new BadRequestException('文件内容为空');
    }
    if (buffer.length > ProjectsController.MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `文件超过 5MB 限制（当前 ${(buffer.length / 1024 / 1024).toFixed(1)}MB），请压缩后上传`,
      );
    }

    const fileName: string = dto.fileName || 'upload';
    const mimeType: string = dto.mimeType || 'application/octet-stream';
    const fileType: string = this.detectFileType(mimeType, fileName);
    const fileSize: number = buffer.length;

    let parsedContent: string | null = null;
    try {
      parsedContent = await this.parseFileContent(buffer, fileType, fileName);
    } catch (err) {
      this.logger.warn(`文件解析失败 ${fileName}: ${String(err)}`);
    }
    parsedContent = this.sanitizeText(parsedContent);

    const contentSummary: string | null = parsedContent
      ? parsedContent.slice(0, 500)
      : null;

    // 文件字节落库（自建部署无平台对象存储，见 MaterialBlobService 注释）
    const created = await this.projectsService.addMaterial(
      id,
      fileName,
      fileType,
      fileSize,
      '', // file_path 由 MaterialBlobService 写为 db:<id>
      contentSummary,
      parsedContent,
      { userId: user.userId, role: user.role },
    );
    await this.materialBlobs.save(created.id, buffer, mimeType);
    this.scheduleImageAnalysis(created.id, user.userId, fileType);
    return created;
  }

  /**
   * 素材文件下载/预览。字节来自 material_blobs 表。
   * 图片与 PDF 内联展示，其余类型按附件下载。
   *
   * 实现说明（重要，勿"简化"回 StreamableFile）：这里必须 @Res() 完全接管并
   * 手工分块写。平台 LoggingInterceptor 会对 handler 返回值无条件
   * JSON.stringify —— StreamableFile 内部持有全量 buffer（经 Readable 的
   * _readableState），会被展开成约 5 倍大小的数字数组字符串再进日志序列化，
   * 在 488MB 内存的容器上直接 OOM（6MB 能活、13.6MB 必死，实测复现）。
   * 手工写则返回值为 undefined，拦截器只会记录小对象。
   */
  @Get(':id/materials/:materialId/download')
  async downloadMaterial(
    @Param('id') id: string,
    @Param('materialId') materialId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: import('express').Response,
  ): Promise<void> {
    const meta = await this.projectsService.getMaterialMeta(
      id,
      materialId,
      { userId: user.userId, role: user.role },
    );
    const blob = await this.materialBlobs.load(materialId);
    if (!blob) {
      throw new NotFoundException('文件内容不存在（可能上传于旧版本，请重新上传）');
    }

    const safeName = meta.fileName.replace(/[\r\n"\\]/g, '_') || 'file';
    const inline = /^image\//.test(blob.contentType) || blob.contentType === 'application/pdf';
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(safeName)}"; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
    );
    res.contentType(blob.contentType);
    res.setHeader('Content-Length', String(blob.data.length));

    const CHUNK = 256 * 1024;
    let written = 0;
    await new Promise<void>((resolve, reject) => {
      res.on('error', reject);
      const writeNext = (): void => {
        while (written < blob.data.length) {
          const end = Math.min(written + CHUNK, blob.data.length);
          const ok = res.write(blob.data.subarray(written, end));
          written = end;
          if (!ok) {
            res.once('drain', writeNext);
            return;
          }
        }
        res.end();
        resolve();
      };
      writeNext();
    });
  }

  @Get(':id/materials')
  async listMaterials(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ProjectMaterial[]> {
    return this.projectsService.listMaterials(id, { userId: user.userId, role: user.role });
  }

  private detectFileType(mimetype: string, fileName: string): string {
    const lowerName: string = fileName.toLowerCase();
    if (
      mimetype.startsWith('image/') ||
      /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(lowerName)
    ) {
      return 'image';
    }
    if (mimetype === 'application/pdf' || lowerName.endsWith('.pdf')) {
      return 'pdf';
    }
    if (
      mimetype.includes('spreadsheet') ||
      mimetype.includes('excel') ||
      /\.(xlsx|xls|csv)$/.test(lowerName)
    ) {
      return 'spreadsheet';
    }
    if (
      mimetype.includes('word') ||
      mimetype === 'application/msword' ||
      /\.(docx?)$/.test(lowerName)
    ) {
      return 'document';
    }
    if (
      mimetype.startsWith('text/') ||
      /\.(txt|md|markdown|csv|json|xml|html)$/.test(lowerName)
    ) {
      return 'text';
    }
    return 'other';
  }

  private async extractPdfText(buffer: Buffer): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const pythonScript = `
import sys, json

try:
    data = sys.stdin.buffer.read()
except Exception as e:
    print(json.dumps({"success": False, "error": f"read stdin failed: {e}"}), file=sys.stderr)
    sys.exit(1)

lib_errors = []

# 1. pymupdf (fitz)
try:
    try:
        import pymupdf
    except ImportError:
        import fitz as pymupdf
    doc = pymupdf.open(stream=data, filetype="pdf")
    texts = []
    for page in doc:
        t = page.get_text()
        if t.strip():
            texts.append(t)
    doc.close()
    result = chr(10).join(texts)
    if result.strip():
        print(json.dumps({"success": True, "text": result[:20000], "pages": len(texts) or doc.page_count, "lib": "pymupdf"}))
        sys.exit(0)
    # 文本为空，继续尝试下一个库
except ImportError as e:
    lib_errors.append(f"pymupdf: {e}")
except Exception as e:
    lib_errors.append(f"pymupdf error: {e}")

# 2. pypdf
try:
    from pypdf import PdfReader
    import io
    reader = PdfReader(io.BytesIO(data))
    texts = []
    for page in reader.pages:
        t = page.extract_text() or ''
        if t.strip():
            texts.append(t)
    result = chr(10).join(texts)
    if result.strip():
        print(json.dumps({"success": True, "text": result[:20000], "pages": len(texts) or len(reader.pages), "lib": "pypdf"}))
        sys.exit(0)
    # 文本为空，继续尝试下一个库
except ImportError as e:
    lib_errors.append(f"pypdf: {e}")
except Exception as e:
    lib_errors.append(f"pypdf error: {e}")

# 3. pdfplumber
try:
    import pdfplumber
    import io
    texts = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            t = page.extract_text() or ''
            if t.strip():
                texts.append(t)
    result = chr(10).join(texts)
    if result.strip():
        print(json.dumps({"success": True, "text": result[:20000], "pages": len(texts) or page_count, "lib": "pdfplumber"}))
        sys.exit(0)
    # 文本为空，继续尝试下一个库
except ImportError as e:
    lib_errors.append(f"pdfplumber: {e}")
except Exception as e:
    lib_errors.append(f"pdfplumber error: {e}")

# 4. pdfminer.six
try:
    from pdfminer.high_level import extract_text
    import io
    result = extract_text(io.BytesIO(data))
    pages = result.count(chr(12)) + 1 if chr(12) in result else 1
    if result.strip():
        print(json.dumps({"success": True, "text": result[:20000], "pages": pages, "lib": "pdfminer"}))
        sys.exit(0)
    # 文本为空，继续尝试
except ImportError as e:
    lib_errors.append(f"pdfminer: {e}")
except Exception as e:
    lib_errors.append(f"pdfminer error: {e}")

print(json.dumps({"success": False, "error": "No PDF library available", "details": lib_errors}), file=sys.stderr)
sys.exit(1)
`;
      const child = spawn('python3', ['-c', pythonScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      child.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `python exit code ${code}`));
          return;
        }
        try {
          const result = JSON.parse(stdout.trim());
          if (result.success) {
            resolve(result.text || null);
          } else {
            reject(new Error(result.error || 'unknown error'));
          }
        } catch {
          reject(new Error('invalid JSON output from python'));
        }
      });

      child.on('error', (err: Error) => reject(err));
      child.stdin.write(buffer);
      child.stdin.end();
    });
  }

  private async extractDocxText(buffer: Buffer): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const pythonScript = `
import sys, json

try:
    data = sys.stdin.buffer.read()
except Exception as e:
    print(json.dumps({"success": False, "error": f"read stdin failed: {e}"}), file=sys.stderr)
    sys.exit(1)

lib_errors = []

# 1. python-docx
try:
    import io
    from docx import Document
    doc = Document(io.BytesIO(data))
    texts = []
    for para in doc.paragraphs:
        t = para.text
        if t.strip():
            texts.append(t)
    # Also extract table text
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                texts.append(' | '.join(cells))
    result = chr(10).join(texts)
    if result.strip():
        print(json.dumps({"success": True, "text": result[:20000], "paragraphs": len(texts), "lib": "python-docx"}))
        sys.exit(0)
except ImportError as e:
    lib_errors.append(f"python-docx: {e}")
except Exception as e:
    lib_errors.append(f"python-docx error: {e}")

print(json.dumps({"success": False, "error": "No docx library available", "details": lib_errors}), file=sys.stderr)
sys.exit(1)
`;
      const child = spawn('python3', ['-c', pythonScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      child.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `python exit code ${code}`));
          return;
        }
        try {
          const result = JSON.parse(stdout.trim());
          if (result.success) {
            resolve(result.text || null);
          } else {
            reject(new Error(result.error || 'unknown error'));
          }
        } catch {
          reject(new Error('invalid JSON output from python'));
        }
      });

      child.on('error', (err: Error) => reject(err));
      child.stdin.write(buffer);
      child.stdin.end();
    });
  }

  private async extractXlsxText(buffer: Buffer): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const pythonScript = `
import sys, json

try:
    data = sys.stdin.buffer.read()
except Exception as e:
    print(json.dumps({"success": False, "error": f"read stdin failed: {e}"}), file=sys.stderr)
    sys.exit(1)

lib_errors = []

# 1. openpyxl
try:
    import io
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    sheet_texts = []
    for sheet_name in wb.sheetnames[:5]:
        ws = wb[sheet_name]
        rows_text = []
        for row in ws.iter_rows(values_only=True):
            cells = [str(cell) for cell in row if cell is not None and str(cell).strip()]
            if cells:
                rows_text.append(' | '.join(cells))
        if rows_text:
            sheet_texts.append(f"--- Sheet: {sheet_name} ---\\n" + chr(10).join(rows_text))
    wb.close()
    result = chr(10).join(sheet_texts)
    if result.strip():
        print(json.dumps({"success": True, "text": result[:20000], "sheets": len(sheet_texts), "lib": "openpyxl"}))
        sys.exit(0)
except ImportError as e:
    lib_errors.append(f"openpyxl: {e}")
except Exception as e:
    lib_errors.append(f"openpyxl error: {e}")

print(json.dumps({"success": False, "error": "No xlsx library available", "details": lib_errors}), file=sys.stderr)
sys.exit(1)
`;
      const child = spawn('python3', ['-c', pythonScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      child.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `python exit code ${code}`));
          return;
        }
        try {
          const result = JSON.parse(stdout.trim());
          if (result.success) {
            resolve(result.text || null);
          } else {
            reject(new Error(result.error || 'unknown error'));
          }
        } catch {
          reject(new Error('invalid JSON output from python'));
        }
      });

      child.on('error', (err: Error) => reject(err));
      child.stdin.write(buffer);
      child.stdin.end();
    });
  }

  /**
   * 文本净化：解析失败回退原始字节时，二进制内容（NUL/控制字符/非法 UTF-8）
   * 会让 Postgres 报 22021 invalid encoding。入库前剥掉所有不可见字符。
   */
  private sanitizeText(value: string | null | undefined): string | null {
    if (!value) return value ?? null;
    // eslint-disable-next-line no-control-regex
    const cleaned = value
      .replace(/\u0000/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\uFFFD/g, '');
    return cleaned.trim() || null;
  }

  /**
   * 解析护栏：容器内存有限（488MB），大文件解析（xlsx 全量读 + python 兜底 +
   * tesseract OCR）会直接把进程 OOM 掉——表现为上传时网关 503 / 容器重启。
   * 超过阈值的文件只入库二进制（blob 完整保留），不做文本解析。
   */
  /** 所有上传入口统一上限 5MB */
  public static readonly MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  private static readonly MAX_PARSE_BYTES = 6 * 1024 * 1024; // 6MB
  private static readonly MAX_OCR_BYTES = 3 * 1024 * 1024; // 3MB

  private async parseFileContent(
    buffer: Buffer,
    fileType: string,
    fileName: string,
  ): Promise<string | null> {
    const lowerName: string = fileName.toLowerCase();

    // 大文件不解析（防 OOM）；文件本体仍会完整存进 blob
    if (buffer.length > ProjectsController.MAX_PARSE_BYTES) {
      this.logger.warn(
        `文件超过解析上限，跳过文本解析（仅存二进制）: ${fileName} (${Math.round(buffer.length / 1024 / 1024)}MB)`,
      );
      return null;
    }

    switch (fileType) {
      case 'image': {
        if (buffer.length > ProjectsController.MAX_OCR_BYTES) {
          this.logger.warn(
            `图片超过 OCR 上限，跳过识别: ${fileName} (${Math.round(buffer.length / 1024 / 1024)}MB)`,
          );
          return null;
        }
        try {
          const worker = await tesseract.createWorker('eng');
          const result = await worker.recognize(buffer);
          await worker.terminate();
          const text = result.data.text?.trim();
          return text || null;
        } catch (err) {
          this.logger.warn(`图片 OCR 解析失败 ${fileName}: ${String(err)}`);
          return null;
        }
      }

      case 'pdf': {
        try {
          const text = await this.extractPdfText(buffer);
          this.logger.log(`PDF 解析完成 ${fileName}: ${text?.length ?? 0} chars`);
          return text?.trim() || null;
        } catch (err) {
          this.logger.warn(`PDF 解析失败 ${fileName}: ${String(err)}`);
          return null;
        }
      }

      case 'spreadsheet': {
        try {
          if (lowerName.endsWith('.csv')) {
            const text = this.sanitizeText(buffer.toString('utf-8'));
            return text || null;
          }
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          const sheetTexts: string[] = [];
          for (const sheetName of workbook.SheetNames.slice(0, 5)) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
            if (csv.trim()) {
              sheetTexts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
            }
          }
          if (sheetTexts.length > 0) {
            return sheetTexts.join('\n\n');
          }
          // JS 库解析失败，尝试 Python openpyxl 兜底
          this.logger.warn(`xlsx JS 库解析内容为空，尝试 Python openpyxl: ${fileName}`);
          const pyText = await this.extractXlsxText(buffer);
          return pyText?.trim() || null;
        } catch (err) {
          this.logger.warn(`Excel JS 解析失败，尝试 Python 兜底: ${fileName}: ${String(err)}`);
          try {
            if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
              const pyText = await this.extractXlsxText(buffer);
              return pyText?.trim() || null;
            }
            const text = this.sanitizeText(buffer.toString('utf-8'));
            return text || null;
          } catch (pyErr) {
            this.logger.warn(`Excel Python 兜底也失败 ${fileName}: ${String(pyErr)}`);
            try {
              const text = this.sanitizeText(buffer.toString('utf-8'));
              return text || null;
            } catch {
              return null;
            }
          }
        }
      }

      case 'document': {
        try {
          if (lowerName.endsWith('.docx')) {
            const result = await mammoth.extractRawText({ buffer });
            const text = result.value?.trim();
            if (text && text.length > 0) {
              return text;
            }
            // mammoth 结果为空，尝试 python-docx 兜底
            this.logger.warn(`mammoth 解析内容为空，尝试 python-docx: ${fileName}`);
            const pyText = await this.extractDocxText(buffer);
            return pyText?.trim() || null;
          }
          if (lowerName.endsWith('.doc')) {
            this.logger.warn(`不支持 .doc 格式（需 .docx），跳过: ${fileName}`);
            return null;
          }
          return null;
        } catch (err) {
          this.logger.warn(`Word JS 解析失败，尝试 Python 兜底: ${fileName}: ${String(err)}`);
          try {
            if (lowerName.endsWith('.docx')) {
              const pyText = await this.extractDocxText(buffer);
              return pyText?.trim() || null;
            }
            return null;
          } catch (pyErr) {
            this.logger.warn(`Word Python 兜底也失败 ${fileName}: ${String(pyErr)}`);
            return null;
          }
        }
      }

      case 'text': {
        try {
          const text = this.sanitizeText(buffer.toString('utf-8'));
          return text || null;
        } catch {
          return null;
        }
      }

      default:
        return null;
    }
  }
}
