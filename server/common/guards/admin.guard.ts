import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { RequestWithUser } from '@server/modules/auth/jwt-auth.guard';

/**
 * 管理员权限（管用户 + 忘记密码的验证码邮箱）。
 * 注意：**不再**意味着"能看全量数据"——数据可见性由各处按 owner 判断，
 * 只有 super_admin 能跨用户看。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      throw new ForbiddenException('需要管理员权限');
    }

    return true;
  }
}
