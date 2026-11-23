/**
 * 退订 token 工具：HMAC-SHA256 签名，无需存库、不可伪造、无过期（永久退订）。
 *
 * token 格式：base64url(email) + "." + base64url(hmac)
 * 邮箱已编码进 token，退订端点直接从 token 解析邮箱——URI 里不出现明文邮箱，
 * 符合 RFC 8058 对 opaque identifier 的建议。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

/** 生成退订 token */
export function makeUnsubscribeToken(emailRaw: string): string {
  const email = emailRaw.trim().toLowerCase();
  const payload = b64url(email);
  return `${payload}.${sign(payload)}`;
}

/**
 * 验证并解析 token；无效返回 null。
 * 用 timingSafeEqual 防时序侧信道（与忘记密码验证码同一套防御）。
 */
export function parseUnsubscribeToken(token: string): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const email = Buffer.from(payload, 'base64url').toString('utf8').trim().toLowerCase();
    return email.includes('@') ? email : null;
  } catch {
    return null;
  }
}

/** 构造消息里用的 HTTPS 退订链接（ PUBLIC_BASE_URL 必填，否则给相对路径） */
export function buildUnsubscribeUrl(token: string): string {
  const base = (process.env.PUBLIC_BASE_URL || 'https://shanghaitrade.cn').replace(/\/+$/, '');
  return `${base}/openapi/unsubscribe/one-click?token=${encodeURIComponent(token)}`;
}
