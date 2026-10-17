import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql, eq } from 'drizzle-orm';
import { materialBlobs } from '@server/database/schema';

/**
 * 素材文件的本地存储（Postgres bytea）。
 *
 * 为什么不用平台的 FileService：它 upload 前必须先调平台 API
 * `/b/{appId}/get_published_v2` 拿默认存储桶，自建部署上这个接口不存在，
 * 请求回落到 SPA 的 index.html，`res.json()` 直接抛
 * `SyntaxError: Unexpected token '<'` → 素材上传 500（从未成功过）。
 *
 * 为什么落库而不是落盘：Northflank 容器每次部署都重建，磁盘文件全丢；
 * DB 与业务表同库持久，重启/重部署后文件仍可下载。
 *
 * 首次使用前做幂等迁移（建表 + 授权给平台三角色）。GRANT 必须有：
 * 平台中间件按请求 `SET LOCAL ROLE anon_/authenticated_/service_role_`，
 * 新表若不授权，运行时 DML 直接 permission denied。
 * 单独 GRANT 而不依赖 init-db.js：生产库连接串不落在仓库里，部署后
 * 没人手动重跑 init-db，启动期自愈才能保证功能开箱可用。
 */
@Injectable()
export class MaterialBlobService {
  private readonly logger = new Logger(MaterialBlobService.name);
  private ensurePromise: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 幂等建表 + 授权；只跑一次，失败不抛出（下次调用重试）。 */
  private ensureTable(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = (async () => {
        // 不能走 this.db（drizzle）执行 DDL：请求上下文里 datapaas 会把每条
        // 查询包进 `SET LOCAL ROLE anon_/authenticated_/service_role_` 的事务，
        // 这些角色只有 DML 权限，CREATE TABLE / GRANT 直接失败。
        // $client 是底层 postgres-js 实例（已实测 db.$client === client），
        // 绕开 drizzle 的被 patch 路径，以连接用户（schema owner）身份执行。
        const raw = (this.db as unknown as { $client?: { unsafe: (q: string) => Promise<unknown> } }).$client;
        if (!raw?.unsafe) {
          throw new Error('无法获取底层 postgres 客户端（db.$client 不存在），无法执行 material_blobs 建表迁移');
        }
        await raw.unsafe(`
          CREATE TABLE IF NOT EXISTS material_blobs (
            material_id   uuid PRIMARY KEY REFERENCES project_materials(id) ON DELETE CASCADE,
            content_type  varchar(100) NOT NULL DEFAULT 'application/octet-stream',
            data          bytea NOT NULL,
            _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        // 角色不存在（如平台托管库）时授权失败可容忍——那种环境不走
        // SET LOCAL ROLE 中间件；记录日志即可，下次调用不再重复尝试。
        try {
          await raw.unsafe(
            'GRANT ALL PRIVILEGES ON TABLE material_blobs TO anon_, authenticated_, service_role_',
          );
        } catch (err) {
          this.logger.warn(`material_blobs 授权失败（可忽略于非自建环境）: ${String(err).split('\n')[0]}`);
        }
        this.logger.log('material_blobs 表已就绪');
      })().catch((err) => {
        this.ensurePromise = null; // 允许下次重试
        throw err;
      });
    }
    return this.ensurePromise;
  }

  /** 保存/覆盖素材字节，并把 file_path 标记为 db:<id>（该列现无消费者，仅语义标记）。 */
  async save(materialId: string, data: Buffer, contentType: string): Promise<void> {
    await this.ensureTable();
    await this.db
      .insert(materialBlobs)
      .values({ materialId, data, contentType })
      .onConflictDoUpdate({
        target: materialBlobs.materialId,
        set: { data, contentType },
      });
    await this.db.execute(
      sql`UPDATE project_materials SET file_path = ${'db:' + materialId} WHERE id = ${materialId}`,
    );
  }

  /** 读取素材字节；不存在返回 null。 */
  async load(
    materialId: string,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    await this.ensureTable();
    const rows = await this.db
      .select({ data: materialBlobs.data, contentType: materialBlobs.contentType })
      .from(materialBlobs)
      .where(eq(materialBlobs.materialId, materialId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { data: Buffer.from(row.data), contentType: row.contentType };
  }
}