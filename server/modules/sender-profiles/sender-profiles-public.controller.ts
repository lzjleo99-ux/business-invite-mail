import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SenderProfilesService } from './sender-profiles.service';

/**
 * 签名图片公开读取：挂 /openapi/ 前缀（平台对该前缀免 CSRF/登录，
 * 与机器人导入同机制）——收件人邮件客户端不带任何凭据也能加载签名图。
 */
@Controller('openapi/sender-profiles')
export class SenderProfilesPublicController {
  constructor(private readonly profiles: SenderProfilesService) {}

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
