import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { RequestWithUser } from '@server/modules/auth/jwt-auth.guard';

/**
 * 超级管理员专属。全系统只能有一个 super_admin（见 AdminService.assertSingleSuperAdmin）。
 * 用于：跨用户查看数据、发放/回收 super_admin 身份。
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user || user.role !== 'super_admin') {
      throw new ForbiddenException('需要超级管理员权限');
    }

    return true;
  }
}
