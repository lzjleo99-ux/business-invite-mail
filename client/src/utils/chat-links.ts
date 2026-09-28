import { normalizeSerbianPhone } from '@client/common/utils/phone-normalizer';
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
export function openExternal(url: string): void {
  if (isWeComWebview()) {
    window.location.href = `wxlink://open?url=${encodeURIComponent(url)}`;
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
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
