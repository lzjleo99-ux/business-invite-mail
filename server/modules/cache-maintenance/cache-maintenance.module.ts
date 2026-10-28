import { Module } from '@nestjs/common';
import { SharedMailModule } from '@server/common/mail.module';
import { CacheMaintenanceController } from './cache-maintenance.controller';
import { CacheMaintenanceService } from './cache-maintenance.service';

/**
 * 缓存维护模块：定时（每 3 天）+ 手动清理本应用的可再生缓存。
 * 不涉及任何平台/系统级缓存。
 */
@Module({
  imports: [SharedMailModule],
  controllers: [CacheMaintenanceController],
  providers: [CacheMaintenanceService],
  exports: [CacheMaintenanceService],
})
export class CacheMaintenanceModule {}
