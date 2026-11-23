/**
 * 合规查询端点（管理员）：邮箱来源证据链 + 退订名单。
 * GDPR Art.15 数据主体访问权 / Art.14 告知义务的举证支持。
 */
import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '@server/modules/auth/jwt-auth.guard';
import { AdminGuard } from '@server/common/guards/admin.guard';
import { ProvenanceService } from './provenance.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('api/compliance')
export class ComplianceController {
  constructor(private readonly provenance: ProvenanceService) {}

  /** 某公司的邮箱来源证据 */
  @Get('provenance/company')
  async byCompany(
    @Query('companyId') companyId: string,
  ): Promise<{ items: Awaited<ReturnType<ProvenanceService['listByCompany']>> }> {
    if (!companyId) throw new BadRequestException('companyId required');
    return { items: await this.provenance.listByCompany(companyId) };
  }

  /** 按邮箱反查来源（收到数据主体询问时用） */
  @Get('provenance/email')
  async byEmail(@Query('email') email: string): Promise<{ items: unknown[] }> {
    if (!email?.includes('@')) throw new BadRequestException('valid email required');
    return { items: await this.provenance.listByEmail(email) };
  }

  /** 项目来源统计 */
  @Get('provenance/stats')
  async stats(
    @Query('projectId') projectId: string,
  ): Promise<{ items: Awaited<ReturnType<ProvenanceService['statsByProject']>> }> {
    if (!projectId) throw new BadRequestException('projectId required');
    return { items: await this.provenance.statsByProject(projectId) };
  }
}
