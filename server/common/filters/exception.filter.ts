import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { BusinessException } from '../interfaces/exception.interface';
import { HTTP_STATUS_TO_RESPONSE_CODE_MAP, ResponseCode } from '../constants/api_response_code';
import { ApiErrorResponse } from '../interfaces/api_response.interface';

/**
 * 全局异常过滤器，捕获所有未处理的异常。
 *
 * 2026-11-05 全面审计修复：
 * 1. drizzle(postgres-js) 会把 Postgres 原生错误包在 `DrizzleQueryError.cause` 里，
 *    原实现只检查顶层 `exception.code === '22P02'`，因此非法 UUID 一律漏判，
 *    在 10+ 个端点表现为 500「服务器内部错误」，还把完整 SQL 堆栈回给浏览器。
 *    现在沿 cause 链递归查找 Postgres SQLSTATE，并给出明确的业务语义。
 * 2. `ApiErrorResponse.stack` 注释写明「仅开发环境」，原实现却无条件下发
 *    stack/cause（含 SQL 语句、表结构、服务器文件路径）——生产环境信息泄漏。
 *    现在只写服务端日志，开发环境才回传。业务异常（4xx）的 message 不受影响，
 *    模型无 Key / 网络错误等具体原因仍会原样透出。
 */

/** 常见 Postgres SQLSTATE → 对外的明确提示（避免笼统 500） */
const PG_ERROR_MAP: Record<
  string,
  { status: HttpStatus; code: ResponseCode; message: string }
> = {
  // invalid_text_representation：非法 UUID 进了 uuid 列（脏 ID / 路由误捕获）
  '22P02': {
    status: HttpStatus.NOT_FOUND,
    code: ResponseCode.NOT_FOUND,
    message: '资源不存在或 ID 格式不正确',
  },
  // invalid byte sequence：上传文件里的非法 UTF-8 字节
  '22021': {
    status: HttpStatus.BAD_REQUEST,
    code: ResponseCode.BAD_REQUEST,
    message: '请求内容包含非法字符，请检查上传的文件',
  },
  // unique_violation
  '23505': {
    status: HttpStatus.BAD_REQUEST,
    code: ResponseCode.BAD_REQUEST,
    message: '数据已存在，请勿重复添加',
  },
  // foreign_key_violation
  '23503': {
    status: HttpStatus.BAD_REQUEST,
    code: ResponseCode.BAD_REQUEST,
    message: '关联的数据不存在或已被删除',
  },
  // not_null_violation
  '23502': {
    status: HttpStatus.BAD_REQUEST,
    code: ResponseCode.BAD_REQUEST,
    message: '缺少必填数据',
  },
};

/** 沿异常 cause 链找 Postgres SQLSTATE（drizzle / postgres-js 会包装多层） */
function findPgErrorCode(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 8) return null;
  const obj = value as Record<string, unknown>;
  const code = obj.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  if (obj.cause) {
    const nested = findPgErrorCode(obj.cause, depth + 1);
    if (nested) return nested;
  }
  return null;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // 如果响应头已发送，则不处理
    if (response.headersSent) {
      return;
    }

    let errorResponse: Omit<ApiErrorResponse, 'httpStatus'>;
    let httpStatus: HttpStatus;

    // 优先识别数据库错误：必须在 HttpException 之前，因为 drizzle 的
    // DrizzleQueryError 是普通 Error，但也可能被某些包装器带上 status。
    const pgCode = findPgErrorCode(exception);
    const pgMapped = pgCode ? PG_ERROR_MAP[pgCode] : undefined;

    if (pgMapped && !(exception instanceof BusinessException)) {
      httpStatus = pgMapped.status;
      errorResponse = {
        error: {
          code: pgMapped.code,
          message: pgMapped.message,
          timestamp: Date.now(),
        },
      };
    } else if (exception instanceof BusinessException) {
      // 业务异常
      httpStatus = exception.httpStatus;
      errorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          fieldErrors: exception.fieldErrors,
          timestamp: Date.now(),
        },
      };
    } else if (exception instanceof HttpException) {
      // HTTP 异常（含 class-validator 的参数校验、NotFound/BadRequest 等业务提示）
      httpStatus = exception.getStatus() as HttpStatus;
      const exceptionResponse = exception.getResponse();
      errorResponse = {
        error: {
          code: HTTP_STATUS_TO_RESPONSE_CODE_MAP[httpStatus],
          message: typeof exceptionResponse === 'string' ? exceptionResponse : exception.message,
          details:
            typeof exceptionResponse === 'object' ? JSON.stringify(exceptionResponse) : undefined,
          timestamp: Date.now(),
        },
      };
    } else {
      // 未知异常：完整堆栈只进服务端日志，生产环境绝不回传浏览器
      const err = exception as Error;
      this.logger.error(
        `未处理异常: ${err?.message ?? String(exception)}`,
        err?.stack,
      );
      const isDev = process.env.NODE_ENV === 'development';
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = {
        error: {
          code: ResponseCode.INTERNAL_ERROR,
          message: '服务器内部错误，请稍后重试',
          ...(isDev
            ? { stack: err?.stack, cause: err?.cause as string }
            : {}),
          timestamp: Date.now(),
        },
      };
    }

    response.status(httpStatus).json(errorResponse);
  }
}
