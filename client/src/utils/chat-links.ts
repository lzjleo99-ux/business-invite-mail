import { normalizeSerbianPhone } from '@client/src/utils/phone-normalizer';
import type { Company } from '@shared/api.interface';

export type ChatChannel = 'whatsapp' | 'viber';

/** Strip everything but digits (used to build wa.me / viber.me links). */
export function toDigits(phone?: string | null): string {
  return (phone || '').replace(/[^\d]/g, '');
}

/** Detect the WeCom (企业微信) in-app webview, which needs the wxlink bridge. */
export function isWeComWebview(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /wxwork/i.test(navigator.userAgent);
}

/**
 * Open an external URL. Inside WeCom the wxlink:// bridge is required;
 * in a normal browser (e.g. GitHub Pages) a standard new tab works.
 */
export function openExternal(url: string): boolean {
  if (!url) return false;
  if (isWeComWebview()) {
    location.assign(`wxlink://open?url=${encodeURIComponent(url)}`);
    return true;
  }
  // 弹窗拦截器可能在返回 null —— 调用方据此给出可复制的链接兜底
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  return !!win;
}

/** WhatsApp click-to-chat link with a prefilled message. */
export function buildWhatsAppUrl(phoneDigits: string, message: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
}

/**
 * Viber chat link, mirroring the reference site
 * (https://lzjleo99-ux.github.io/novascan-web/contact.html -> https://viber.me/<digits>).
 * viber.me opens the Viber chat in-app / via the Viber landing page.
 */
export function buildViberUrl(phoneDigits: string): string {
  return `https://viber.me/${phoneDigits}`;
}

/** Native Viber deep link as a fallback (opens the app directly on mobile). */
export function buildViberNativeUrl(phoneDigits: string): string {
  return `viber://chat?number=${phoneDigits}`;
}

export function buildChatUrl(
  channel: ChatChannel,
  phoneDigits: string,
  message: string,
): string {
  return channel === 'whatsapp'
    ? buildWhatsAppUrl(phoneDigits, message)
    : buildViberUrl(phoneDigits);
}

/** Best international (E.164) number available for a company, for either IM app. */
export function bestChatPhone(record: Company): string {
  return (
    record.normalizedWhatsappPhone ||
    record.normalizedPhone ||
    record.viberPhone ||
    normalizeSerbianPhone(record.websiteContactPhone || record.phone || '', record.country || '') ||
    genericPhoneDigits(record.websiteContactPhone || record.phone)
  );
}

/** 通用号码兜底：从任意原始号码里取数字（+33 6 12 22 18 74 → 33612221874）。 */
export function genericPhoneDigits(value: string | null | undefined): string {
  const digits = String(value || '').replace(/[^\d]/g, '');
  // 去掉国际前缀 00
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

/**
 * Best number for WhatsApp.
 * 之前要求 phoneType === 'mobile'，而大量抓取到的号码类型是 'unknown'
 * （比如法国 +33612221874）→ 取不到号 → 按钮变禁用态，点了没反应。
 * 现在：**只有明确是座机（landline）才排除**，其余一律可用
 * （WhatsApp 本身也支持座机号，只是体验略差）。
 */
export function bestWhatsAppPhone(record: Company): string {
  return (
    record.normalizedWhatsappPhone ||
    (record.phoneType !== 'landline' ? record.normalizedPhone : '') ||
    (!record.normalizedPhone && record.phoneType !== 'landline'
      ? genericPhoneDigits(record.websiteContactPhone || record.phone)
      : '') ||
    ''
  );
}

/** Best number for Viber (works with mobile or landline). */
export function bestViberPhone(record: Company): string {
  return (
    record.viberPhone ||
    record.normalizedPhone ||
    record.normalizedWhatsappPhone ||
    normalizeSerbianPhone(record.websiteContactPhone || record.phone || '', record.country || '')
  );
}

/** Any usable phone number at all (mobile or landline). */
export function hasAnyPhone(record: Company): boolean {
  return !!bestChatPhone(record);
}

/** True when the only known number looks like a landline (IM may not work). */
export function isLikelyLandline(record: Company): boolean {
  return (
    !record.normalizedWhatsappPhone &&
    !!record.normalizedPhone &&
    record.phoneType === 'landline'
  );
}

/** Copy text with a legacy textarea fallback for non-secure contexts. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Open a chat link synchronously (in the click handler stack) so that the
 * browser does not block the popup. The message text is copied to the
 * clipboard afterwards; the function itself returns void (no Promise) so
 * callers can use it directly in onClick without awaiting.
 */
export function openChatSync(
  channel: ChatChannel,
  phoneDigits: string,
  message: string,
): void {
  const url = buildChatUrl(channel, phoneDigits, message);
  openExternal(url);

  if (message) {
    void copyToClipboard(message).catch(() => {
      /* clipboard failure is non-fatal; the window is already open */
    });
  }
}

/** Whether the company has a phone number usable for the given channel. */
export function hasChatPhone(
  record: Company,
  channel: ChatChannel,
): boolean {
  if (channel === 'whatsapp') {
    return !!bestWhatsAppPhone(record);
  }
  return !!bestViberPhone(record);
}
