import type { UserRole } from '@shared/api.interface';
import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, asc, max, sql, isNotNull, count, and } from 'drizzle-orm';
import {
  projects,
  projectMaterials,
  restaurants,
  materialImageDescriptions,
  projectMeta,
} from '@server/database/schema';
import { runIdempotentMigration } from '@server/common/utils/ddl-runner';
import { generateProjectCode } from './project-code';
import { ImageAnalysisService } from './image-analysis.service';
import type {
  Project,
  ProjectMaterial,
  CreateProjectRequest,
  UpdateProjectRequest,
} from '@shared/api.interface';

export interface UserContext {
  userId: string;
  role: UserRole;
}

interface ProjectStatsRow {
  projectId: string;
  companyCount: number;
  generatedCount: number;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly imageAnalysis: ImageAnalysisService,
  ) {}

  /** 建表迁移的 memoize：进程内只跑一次（查询路径上的请求期 DDL 已验证可行） */
  private ensureColumnsPromise?: Promise<void>;

  /**
   * 幂等迁移：CREATE 新表 project_meta（机器人项目代码 + 项目网址）。
   *
   * 为什么独立成表：projects 由 init-db 身份拥有，请求路径上的 ALTER 会
   * "must be owner"（生产已踩过）；而 CREATE 新表由运行时身份建、即拥有，
   * 已验证可行（material_image_descriptions 先例）。onModuleInit 在该平台
   * 不可靠，沿用"查询路径上的请求期 DDL" + memoize。存量项目在此回填代码。
   */
  private ensureProjectColumns(): Promise<void> {
    if (!this.ensureColumnsPromise) {
      this.ensureColumnsPromise = runIdempotentMigration(
        this.db,
        'project_meta 建表迁移',
        async (run) => {
          await run(`
            CREATE TABLE IF NOT EXISTS project_meta (
              project_id  uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
              code        varchar(16),
              website     varchar(500),
              _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
          `);
          await run(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_project_meta_code ON project_meta (code) WHERE code IS NOT NULL`,
          );
          // 请求路径的查询走 anon_/authenticated_ 角色——新表不授权就是
          // "permission denied"（表由运行时身份拥有）。平台托管库没有这些角色，
          // 授权失败可容忍。
          try {
            await run(
              'GRANT ALL PRIVILEGES ON TABLE project_meta TO anon_, authenticated_, service_role_',
            );
          } catch (err) {
            this.logger.warn(
              `project_meta 授权失败（可忽略于非自建环境）: ${String(err).split('\n')[0]}`,
            );
          }
          // 回填：还没有 meta 行的项目逐个建（代码撞唯一索引就换一个重试）
          const need = await run(
            `SELECT id FROM projects WHERE id NOT IN (SELECT project_id FROM project_meta)`,
          );
          const rows = (need as { id: string }[] | undefined) ?? [];
          for (const row of rows) {
            for (let attempt = 0; attempt < 5; attempt += 1) {
              const code = generateProjectCode();
              try {
                await run(
                  `INSERT INTO project_meta (project_id, code) VALUES ('${row.id}', '${code}') ON CONFLICT (project_id) DO NOTHING`,
                );
                break;
              } catch {
                if (attempt === 4) {
                  this.logger.warn(`项目 ${row.id} 代码生成连续碰撞，跳过（下次查询再试）`);
                }
              }
            }
          }
        },
      )
        .then(() => undefined)
        .catch((err: unknown) => {
          // 迁移失败不能永久卡死后续查询：清掉 memoize，下次请求重试
          this.ensureColumnsPromise = undefined;
          throw err;
        });
    }
    return this.ensureColumnsPromise;
  }

  /**
   * 多租户隔离（Finbuckle 式集中过滤）：项目列表/详情一律只看自己的。
   * super_admin 不再有"全量可见"例外——管理面（用户管理）走独立端点，
   * 业务数据（项目/公司/邮件）严格按属主隔离，任何用户互不可见。
   */
  private ownerCondition(user: UserContext) {
    return eq(projects.ownerId, user.userId);
  }

  async findAll(user: UserContext): Promise<Project[]> {
    await this.ensureProjectColumns();
    const ownerCond = this.ownerCondition(user);
    const whereClause = ownerCond ? ownerCond : undefined;

    const projectFields = {
      id: projects.id,
      name: projects.name,
      description: projects.description,
      sortOrder: projects.sortOrder,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      code: projectMeta.code,
      website: projectMeta.website,
    };
    const baseQuery = whereClause
      ? this.db
          .select(projectFields)
          .from(projects)
          .leftJoin(projectMeta, eq(projectMeta.projectId, projects.id))
          .where(whereClause)
      : this.db
          .select(projectFields)
          .from(projects)
          .leftJoin(projectMeta, eq(projectMeta.projectId, projects.id));

    const projectRows = await baseQuery.orderBy(asc(projects.sortOrder));

    const projectIds: string[] = projectRows.map((p) => p.id);

    // 批量统计每个项目的公司数和已生成数
    const statsRows = await this.db
      .select({
        projectId: restaurants.projectId,
        companyCount: count(),
        generatedCount: sql<number>`count(*) filter (where ${restaurants.status} = 'generated')`,
      })
      .from(restaurants)
      .where(
        and(
          isNotNull(restaurants.projectId),
          projectIds.length > 0
            ? sql`${restaurants.projectId} = ANY(ARRAY[${sql.join(
                projectIds.map((id: string) => sql`${id}::uuid`),
                sql`, `,
              )}])`
            : sql`false`,
        ),
      )
      .groupBy(restaurants.projectId);

    const statsByProject = new Map<string, { companyCount: number; generatedCount: number }>();
    for (const row of statsRows as ProjectStatsRow[]) {
      if (row.projectId) {
        statsByProject.set(row.projectId, {
          companyCount: Number(row.companyCount),
          generatedCount: Number(row.generatedCount),
        });
      }
    }

    const result: Project[] = [];
    for (const p of projectRows) {
      const stats = statsByProject.get(p.id) ?? { companyCount: 0, generatedCount: 0 };
      result.push({
        id: p.id,
        name: p.name,
        description: p.description,
        code: p.code,
        website: p.website,
        sortOrder: p.sortOrder,
        companyCount: stats.companyCount,
        generatedCount: stats.generatedCount,
        materials: [],
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      });
    }
    return result;
  }

  async findOne(id: string, user: UserContext): Promise<Project> {
    await this.ensureProjectColumns();
    const ownerCond = this.ownerCondition(user);
    const whereClause = ownerCond
      ? and(eq(projects.id, id), ownerCond)
      : eq(projects.id, id);

    const projectRows = await this.db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        sortOrder: projects.sortOrder,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        code: projectMeta.code,
        website: projectMeta.website,
      })
      .from(projects)
      .leftJoin(projectMeta, eq(projectMeta.projectId, projects.id))
      .where(whereClause);

    if (projectRows.length === 0) {
      throw new NotFoundException('项目不存在');
    }

    const p = projectRows[0];

    // 统计数据
    const statsRows = await this.db
      .select({
        companyCount: count(),
        generatedCount: sql<number>`count(*) filter (where ${restaurants.status} = 'generated')`,
      })
      .from(restaurants)
      .where(eq(restaurants.projectId, id));

    const stats = statsRows[0] as { companyCount: number | bigint; generatedCount: number };

    // 材料列表（join 描述表，图片素材带 AI 视觉描述）
    const materialRows = await this.db
      .select({
        id: projectMaterials.id,
        projectId: projectMaterials.projectId,
        fileName: projectMaterials.fileName,
        fileType: projectMaterials.fileType,
        fileSize: projectMaterials.fileSize,
        contentSummary: projectMaterials.contentSummary,
        imageDescription: materialImageDescriptions.description,
        sortOrder: projectMaterials.sortOrder,
        createdAt: projectMaterials.createdAt,
      })
      .from(projectMaterials)
      .leftJoin(materialImageDescriptions, eq(materialImageDescriptions.materialId, projectMaterials.id))
      .where(eq(projectMaterials.projectId, id))
      .orderBy(asc(projectMaterials.sortOrder));

    const materials: ProjectMaterial[] = materialRows.map((m) => ({
      id: m.id,
      projectId: m.projectId,
      fileName: m.fileName,
      fileType: m.fileType,
      fileSize: m.fileSize,
      contentSummary: m.contentSummary,
      imageDescription: m.imageDescription
        ? m.imageDescription.replace(/^(vision|fallback):/, '')
        : null,
      sortOrder: m.sortOrder,
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      code: p.code,
      website: p.website,
      sortOrder: p.sortOrder,
      companyCount: Number(stats.companyCount),
      generatedCount: Number(stats.generatedCount),
      materials,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async create(data: CreateProjectRequest, user: UserContext): Promise<Project> {
    await this.ensureProjectColumns();
    const maxOrderResult = await this.db
      .select({ max: max(projects.sortOrder) })
      .from(projects);
    const nextSortOrder = ((maxOrderResult[0]?.max as number | null) ?? 0) + 1;

    const inserted = await this.db
      .insert(projects)
      .values({
        name: data.name,
        description: data.description ?? '',
        sortOrder: nextSortOrder,
        ownerId: user.userId,
      })
      .returning({ id: projects.id });

    // meta 行带生成的代码；撞唯一索引就换一个重试
    let code: string | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateProjectCode();
      try {
        await this.db
          .insert(projectMeta)
          .values({ projectId: inserted[0].id, code: candidate });
        code = candidate;
        break;
      } catch {
        if (attempt === 4) {
          this.logger.warn(
            `项目 ${inserted[0].id} 代码生成连续碰撞，创建为无代码（下次查询回填）`,
          );
        }
      }
    }

    const p = inserted[0];
    return {
      id: p.id,
      name: data.name,
      description: data.description ?? '',
      code,
      website: null,
      sortOrder: nextSortOrder,
      companyCount: 0,
      generatedCount: 0,
      materials: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async update(
    id: string,
    data: UpdateProjectRequest,
    user: UserContext,
  ): Promise<Project> {
    const patch: Partial<typeof projects.$inferInsert> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    // website 不进 patch（它在 meta 表），但不能因为"只改了网址"就在这里提前返回——
    // 下面的 website upsert 才是真正的写入点
    if (Object.keys(patch).length === 0 && data.website === undefined) {
      return this.findOne(id, user);
    }

    const ownerCond = this.ownerCondition(user);
    const whereClause = ownerCond
      ? and(eq(projects.id, id), ownerCond)
      : eq(projects.id, id);

    // 只改 website 时 patch 为空——drizzle 的 .set({}) 会抛 "No values to set"，
    // 有更新才跑这句
    if (Object.keys(patch).length > 0) {
      const updated = await this.db
        .update(projects)
        .set(patch)
        .where(whereClause)
        .returning({ id: projects.id });

      if (updated.length === 0) {
        // 区分不存在和无权限
        const existing = await this.db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, id));
        if (existing.length === 0) {
          throw new NotFoundException('项目不存在');
        }
        throw new ForbiddenException('无权操作该项目');
      }
    }

    // website 存 meta 表：upsert（旧项目回填后才有 meta 行）
    if (data.website !== undefined) {
      await this.db
        .insert(projectMeta)
        .values({ projectId: id, website: data.website || null })
        .onConflictDoUpdate({
          target: projectMeta.projectId,
          set: { website: data.website || null, updatedAt: new Date() },
        });
    }

    return this.findOne(id, user);
  }

  async remove(id: string, user: UserContext): Promise<void> {
    const ownerCond = this.ownerCondition(user);
    const whereClause = ownerCond
      ? and(eq(projects.id, id), ownerCond)
      : eq(projects.id, id);

    const projectRows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(whereClause);

    if (projectRows.length === 0) {
      const existing = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, id));
      if (existing.length === 0) {
        throw new NotFoundException('项目不存在');
      }
      throw new ForbiddenException('无权操作该项目');
    }

    // 删除关联的餐厅
    await this.db.delete(restaurants).where(eq(restaurants.projectId, id));

    // 删除项目（材料会通过外键 cascade 自动删除）
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  async addMaterial(
    projectId: string,
    fileName: string,
    fileType: string,
    fileSize: number,
    filePath: string,
    contentSummary: string | null,
    parsedContent: string | null,
    user: UserContext,
  ): Promise<ProjectMaterial> {
    await this.ensureProjectAccess(projectId, user);

    const maxOrderResult = await this.db
      .select({ max: max(projectMaterials.sortOrder) })
      .from(projectMaterials)
      .where(eq(projectMaterials.projectId, projectId));
    const nextSortOrder = ((maxOrderResult[0]?.max as number | null) ?? -1) + 1;

    const inserted = await this.db
      .insert(projectMaterials)
      .values({
        projectId,
        fileName,
        fileType,
        fileSize,
        filePath,
        contentSummary,
        parsedContent,
        sortOrder: nextSortOrder,
      })
      .returning();

    const m = inserted[0];
    return {
      id: m.id,
      projectId: m.projectId,
      fileName: m.fileName,
      fileType: m.fileType,
      fileSize: m.fileSize,
      contentSummary: m.contentSummary,
      imageDescription: null, // 图片描述由 ImageAnalysisService 异步分析后写入独立表
      sortOrder: m.sortOrder,
      createdAt: m.createdAt.toISOString(),
    };
  }

  async removeMaterial(
    projectId: string,
    materialId: string,
    user: UserContext,
  ): Promise<void> {
    await this.ensureProjectAccess(projectId, user);

    const materialRows = await this.db
      .select({ id: projectMaterials.id })
      .from(projectMaterials)
      .where(
        and(
          eq(projectMaterials.id, materialId),
          eq(projectMaterials.projectId, projectId),
        ),
      );

    if (materialRows.length === 0) {
      throw new NotFoundException('材料不存在');
    }

    // TODO: 关联 bucket 信息后清理 dataloom 中的文件
    await this.db
      .delete(projectMaterials)
      .where(eq(projectMaterials.id, materialId));
  }

  /** 下载端点用：校验访问权限并返回素材元数据（不含字节）。 */
  async getMaterialMeta(
    projectId: string,
    materialId: string,
    user: UserContext,
  ): Promise<{ fileName: string; fileType: string }> {
    await this.ensureProjectAccess(projectId, user);
    const rows = await this.db
      .select({
        fileName: projectMaterials.fileName,
        fileType: projectMaterials.fileType,
      })
      .from(projectMaterials)
      .where(
        and(
          eq(projectMaterials.id, materialId),
          eq(projectMaterials.projectId, projectId),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException('材料不存在');
    }
    return rows[0];
  }

  async listMaterials(
    projectId: string,
    user: UserContext,
  ): Promise<ProjectMaterial[]> {
    await this.ensureProjectAccess(projectId, user);

    // listMaterials 要 join material_image_descriptions —— 查询前确保表已迁移
    // （请求期自愈，memoize 后零开销；material_blobs 建表已验证请求期 DDL 可行）。
    await this.imageAnalysis.ensureTable();

    const rows = await this.db
      .select({
        id: projectMaterials.id,
        projectId: projectMaterials.projectId,
        fileName: projectMaterials.fileName,
        fileType: projectMaterials.fileType,
        fileSize: projectMaterials.fileSize,
        contentSummary: projectMaterials.contentSummary,
        imageDescription: materialImageDescriptions.description,
        sortOrder: projectMaterials.sortOrder,
        createdAt: projectMaterials.createdAt,
      })
      .from(projectMaterials)
      .leftJoin(materialImageDescriptions, eq(materialImageDescriptions.materialId, projectMaterials.id))
      .where(eq(projectMaterials.projectId, projectId))
      .orderBy(asc(projectMaterials.sortOrder));

    return rows.map((m) => ({
      id: m.id,
      projectId: m.projectId,
      fileName: m.fileName,
      fileType: m.fileType,
      fileSize: m.fileSize,
      contentSummary: m.contentSummary,
      imageDescription: m.imageDescription
        ? m.imageDescription.replace(/^(vision|fallback):/, '')
        : null,
      sortOrder: m.sortOrder,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  private async ensureProjectAccess(
    id: string,
    user: UserContext,
  ): Promise<void> {
    const ownerCond = this.ownerCondition(user);
    const whereClause = ownerCond
      ? and(eq(projects.id, id), ownerCond)
      : eq(projects.id, id);

    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(whereClause);
    if (rows.length === 0) {
      const existing = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, id));
      if (existing.length === 0) {
        throw new NotFoundException('项目不存在');
      }
      throw new ForbiddenException('无权操作该项目');
    }
  }
}
