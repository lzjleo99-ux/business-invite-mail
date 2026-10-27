import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Res,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { UseInterceptors } from '@nestjs/common';
import { SenderProfilesService } from './sender-profiles.service';
import { JwtAuthGuard, type JwtPayload } from '@server/modules/auth/jwt-auth.guard';
import { CurrentUser } from '@server/modules/auth/current-user.decorator';
import type { SenderProfile, SenderProfileInput } from '@shared/api.interface';

class SaveProfileDto implements SenderProfileInput {
  profileName!: string;
  senderName!: string;
  senderTitle?: string | null;
  companyName?: string | null;
  signatureHtml?: string | null;
  isDefault?: boolean;
}

@Controller('api/sender-profiles')
export class SenderProfilesController {
  constructor(private readonly profiles: SenderProfilesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@CurrentUser() user: JwtPayload): Promise<{ items: SenderProfile[] }> {
    return { items: await this.profiles.list(user.userId) };
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SaveProfileDto,
  ): Promise<SenderProfile> {
    return this.profiles.create(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: Partial<SaveProfileDto>,
  ): Promise<SenderProfile> {
    return this.profiles.update(user.userId, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<{ ok: boolean }> {
    await this.profiles.remove(user.userId, id);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/default')
  async setDefault(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<SenderProfile> {
    return this.profiles.setDefault(user.userId, id);
  }

  /** 签名图片上传（multipart，单文件）→ 返回可插入签名的 URL */
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  @Post('images')
  async uploadImage(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: FileUpload,
  ): Promise<{ id: string; url: string }> {
    if (!file) throw new BadRequestException('缺少文件');
    if (file.size > 1024 * 1024) throw new BadRequestException('图片不能超过 1MB');
    return this.profiles.saveImage(user.userId, file.originalname, file.mimetype, file.buffer);
  }

  /**
   * 图片读取：**公开端点**（收件人邮件客户端不带登录态）。
   * 安全性靠 uuid 不可枚举。
   */
  @Get('images/:id')
  async getImage(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const img = await this.profiles.getImageBytes(null, id);
    if (!img) {
      res.status(404).json({ message: 'not found' });
      return;
    }
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(img.bytes);
  }
}

// Multer 的文件类型（与 projects.controller 的 FileUpload 一致）
interface FileUpload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
