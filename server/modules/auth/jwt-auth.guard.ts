import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
  displayName: string;
}

export interface RequestWithUser extends Request {
  user: JwtPayload;
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('未提供有效的认证令牌');
    }

    const token = authHeader.substring(7);

    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('认证令牌无效或已过期');
    }
  }
}
