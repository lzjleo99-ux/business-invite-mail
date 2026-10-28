import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CacheCleanupResult,
  CacheMaintenanceService,
} from './cache-maintenance.service';

/**
 * 缓存维护接口（首页"清理缓存"按钮用）。
 * 只清理本应用的可再生缓存，不影响平台/系统级缓存。
 */
@Controller('api/admin/cache')
@UseGuards(JwtAuthGuard)
export class CacheMaintenanceController {
  constructor(private readonly cacheService: CacheMaintenanceService) {}

  /** 手动清理（首页按钮） */
  @Post('clear')
  async clear(): Promise<CacheCleanupResult> {
    return this.cacheService.cleanManual();
  }

  /** 状态：上次清理时间 + 下次计划 */
  @Get('status')
  status(): {
    lastRun: CacheCleanupResult | null;
    nextRunAt: string | null;
    intervalHours: number;
  } {
    return this.cacheService.getStatus();
  }
}
