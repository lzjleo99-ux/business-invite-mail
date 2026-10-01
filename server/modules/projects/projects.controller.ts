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
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, IsOptional, MinLength } from 'class-validator';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { spawn } from 'child_process';
import { ProjectsService } from './projects.service';

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
  description?: string;
}

class UpdateProjectDto implements UpdateProjectRequest {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
  @IsOptional()
  @IsString()
  description?: string;
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

@Controller('api/projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly fileService: FileService,
  ) {}

  @Get()
  async findAll(): Promise<Project[]> {
    return this.projectsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Project> {
    return this.projectsService.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateProjectDto): Promise<Project> {
    return this.projectsService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<Project> {
    return this.projectsService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.projectsService.remove(id);
  }

  @Post(':id/materials')
  @UseInterceptors(FileInterceptor('file'))
  async addMaterial(
    @Param('id') id: string,
    @UploadedFile() file: FileUpload,
  ): Promise<ProjectMaterial> {
    if (!file) {
      throw new BadRequestException('缺少文件');
    }

    const fileName: string = file.originalname;
    const fileType: string = this.detectFileType(file.mimetype, fileName);
    const fileSize: number = file.size;

    // 上传文件到 dataloom
    const uploadResult = await this.fileService.upload(file.buffer, {
      fileName,
      contentType: file.mimetype,
    });
    const filePath: string = uploadResult.filePath;

    // 解析文件内容
    let parsedContent: string | null = null;
    try {
      parsedContent = await this.parseFileContent(file.buffer, fileType, fileName);
    } catch (err) {
      this.logger.warn(`文件解析失败 ${fileName}: ${String(err)}`);
    }

    // 生成摘要（前 500 字，后续替换为 AI 摘要）
    const contentSummary: string | null = parsedContent
      ? parsedContent.slice(0, 500)
      : null;

    return this.projectsService.addMaterial(
      id,
      fileName,
      fileType,
      fileSize,
      filePath,
      contentSummary,
      parsedContent,
    );
  }

  @Delete(':id/materials/:materialId')
  async removeMaterial(
    @Param('id') id: string,
    @Param('materialId') materialId: string,
  ): Promise<void> {
    await this.projectsService.removeMaterial(id, materialId);
  }

  @Post(':id/materials-base64')
  async addMaterialByBase64(
    @Param('id') id: string,
    @Body() dto: UploadMaterialByBase64Dto,
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
    if (buffer.length > 30 * 1024 * 1024) {
      throw new BadRequestException('文件大小超过 30MB 限制');
    }

    const fileName: string = dto.fileName || 'upload';
    const mimeType: string = dto.mimeType || 'application/octet-stream';
    const fileType: string = this.detectFileType(mimeType, fileName);
    const fileSize: number = buffer.length;

    const uploadResult = await this.fileService.upload(buffer, {
      fileName,
      contentType: mimeType,
    });
    const filePath: string = uploadResult.filePath;

    let parsedContent: string | null = null;
    try {
      parsedContent = await this.parseFileContent(buffer, fileType, fileName);
    } catch (err) {
      this.logger.warn(`文件解析失败 ${fileName}: ${String(err)}`);
    }

    const contentSummary: string | null = parsedContent
      ? parsedContent.slice(0, 500)
      : null;

    return this.projectsService.addMaterial(
      id,
      fileName,
      fileType,
      fileSize,
      filePath,
      contentSummary,
      parsedContent,
    );
  }

  @Get(':id/materials')
  async listMaterials(@Param('id') id: string): Promise<ProjectMaterial[]> {
    return this.projectsService.listMaterials(id);
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

  private async parseFileContent(
    buffer: Buffer,
    fileType: string,
    fileName: string,
  ): Promise<string | null> {
    const lowerName: string = fileName.toLowerCase();

    switch (fileType) {
      case 'image': {
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
            const text = buffer.toString('utf-8').trim();
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
            const text = buffer.toString('utf-8').trim();
            return text || null;
          } catch (pyErr) {
            this.logger.warn(`Excel Python 兜底也失败 ${fileName}: ${String(pyErr)}`);
            try {
              const text = buffer.toString('utf-8').trim();
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
          const text = buffer.toString('utf-8').trim();
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
