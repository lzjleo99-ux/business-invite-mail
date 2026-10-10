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
import { projects, projectMaterials, restaurants } from '@server/database/schema';
import type {
  Project,
  ProjectMaterial,
  CreateProjectRequest,
  UpdateProjectRequest,
} from '@shared/api.interface';

export interface UserContext {
  userId: string;
  role: 'admin' | 'user';
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
  ) {}

  private isAdmin(user: UserContext): boolean {
    return user.role === 'admin';
  }

  private ownerCondition(user: UserContext) {
    if (this.isAdmin(user)) return undefined;
    return eq(projects.ownerId, user.userId);
  }

  async findAll(user: UserContext): Promise<Project[]> {
    const ownerCond = this.ownerCondition(user);
    const whereClause = ownerCond ? ownerCond : undefined;

    const baseQuery = whereClause
      ? this.db.select().from(projects).where(whereClause)
      : this.db.select().from(projects);

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
    const ownerCond = this.ownerCondition(user);
    const whereClause = ownerCond
      ? and(eq(projects.id, id), ownerCond)
      : eq(projects.id, id);

    const projectRows = await this.db
      .select()
      .from(projects)
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

    // 材料列表
    const materialRows = await this.db
      .select()
      .from(projectMaterials)
      .where(eq(projectMaterials.projectId, id))
      .orderBy(asc(projectMaterials.sortOrder));

    const materials: ProjectMaterial[] = materialRows.map((m) => ({
      id: m.id,
      projectId: m.projectId,
      fileName: m.fileName,
      fileType: m.fileType,
      fileSize: m.fileSize,
      contentSummary: m.contentSummary,
      sortOrder: m.sortOrder,
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      sortOrder: p.sortOrder,
      companyCount: Number(stats.companyCount),
      generatedCount: Number(stats.generatedCount),
      materials,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async create(data: CreateProjectRequest, user: UserContext): Promise<Project> {
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
      .returning();

    const p = inserted[0];
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      sortOrder: p.sortOrder,
      companyCount: 0,
      generatedCount: 0,
      materials: [],
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
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

    if (Object.keys(patch).length === 0) {
      return this.findOne(id, user);
    }

    const ownerCond = this.ownerCondition(user);
    const whereClause = ownerCond
      ? and(eq(projects.id, id), ownerCond)
      : eq(projects.id, id);

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

  async listMaterials(
    projectId: string,
    user: UserContext,
  ): Promise<ProjectMaterial[]> {
    await this.ensureProjectAccess(projectId, user);

    const rows = await this.db
      .select()
      .from(projectMaterials)
      .where(eq(projectMaterials.projectId, projectId))
      .orderBy(asc(projectMaterials.sortOrder));

    return rows.map((m) => ({
      id: m.id,
      projectId: m.projectId,
      fileName: m.fileName,
      fileType: m.fileType,
      fileSize: m.fileSize,
      contentSummary: m.contentSummary,
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
