import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import { join } from 'path';
import { __express as hbsExpressEngine } from 'hbs';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
  });
  await configureApp(app, { 
    disableSwagger: true,
  });
  const logger = new Logger('Bootstrap');
  // SERVER_HOST/SERVER_PORT 优先；PaaS（Render 等）只注入 PORT，
  // 端口回落到它，监听地址仍在部署配置里显式设 0.0.0.0。
  const host = process.env.SERVER_HOST || 'localhost';
  const port = Number(process.env.SERVER_PORT || process.env.PORT || '3000');

  // 注册视图引擎, 渲染 client 目录下的 html 文件
  app.setBaseViewsDir(join(process.cwd(), 'dist/client'));
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  // 自托管：直接托管前端静态资源（平台环境由 CDN 提供，自建部署没有 CDN，
  // 若不托管，/assets/* 会被 ViewController 的 '*' 兜底接住返回 index.html，
  // 浏览器拿到的是 HTML 而不是 JS/CSS，页面一片空白）。
  // index: false 是关键：否则 '/' 会被 serve-static 直接当作目录索引返回
  // 原始 index.html，视图渲染（注入 __platform__ / CSRF token）被跳过，
  // 客户端 JSON.parse('{{{__platform__}}}') 抛异常后判定自己是静态托管，
  // 整站静默切换成 localStorage 离线模式（设置、数据全部失效）。
  app.useStaticAssets(join(process.cwd(), 'dist/client'), { index: false });

  await app.listen(port, host);
  logger.log(`Server running on ${host}:${port}`);
  logger.log(`API endpoints ready at http://${host}:${port}/api`);
}

bootstrap();
