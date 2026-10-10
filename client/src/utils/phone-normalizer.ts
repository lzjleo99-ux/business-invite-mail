export interface NormalizePhoneResult {
  normalizedPhone: string | null;
  phoneType: 'mobile' | 'landline' | 'unknown';
  whatsappPhone: string | null;
  viberPhone: string | null;
}

function isSerbiaCountry(country: string | null | undefined): boolean {
  if (!country) return false;
  const c = country.toLowerCase();
  return (
    c.includes('serbia') ||
    c.includes('serbien') ||
    c.includes('塞尔维亚') ||
    c.includes('србија') ||
    c.includes('srbija')
  );
}

function extractFirstNumber(raw: string): string {
  const lines = raw.split(/[\n\r,;]/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && /\d/.test(trimmed)) {
      const cleaned = trimmed.replace(/^(tel|mob|mobile|phone|固定|手机|电话)[:：]\s*/i, '');
      return cleaned || trimmed;
    }
  }
  return raw;
}

function stripExtension(raw: string): string {
  return (
    raw
      .replace(/\b(?:ext|x)\s*[:#.]?\s*\d+.*$/i, '')
      .replace(/(?<=\d)\s*#\s*\d.*$/, '')
  );
}

/**
 * Normalize a phone number to pure digits with country code.
 * Handles Serbian numbers specifically; basic normalization for others.
 *
 * Enhancements:
 * - Strips spaces, hyphens, parentheses, dots, slashes
 * - Detects international prefix (+ or 00)
 * - Drops extension (ext / x / # suffix)
 * - Takes first number from comma/semicolon/newline separated lists
 * - Serbian local leading 0 → 381
 * - Viber works for both mobile and landline; WhatsApp only for mobile
 */
export function normalizePhone(
  phone: string,
  country?: string | null,
): NormalizePhoneResult {
  const empty: NormalizePhoneResult = {
    normalizedPhone: null,
    phoneType: 'unknown',
    whatsappPhone: null,
    viberPhone: null,
  };

  if (!phone || typeof phone !== 'string') {
    return empty;
  }

  let raw: string = phone.trim();
  if (!raw) {
    return empty;
  }

  raw = extractFirstNumber(raw);
  if (!raw) return empty;

  raw = stripExtension(raw);
  if (!raw.trim()) return empty;

  const trimmedRaw: string = raw.trim();
  const hasPlusPrefix = trimmedRaw.startsWith('+');
  const hasDoubleZeroPrefix = /^00\d/.test(trimmedRaw);
  const isInternational = hasPlusPrefix || hasDoubleZeroPrefix;

  let cleaned: string = raw;
  if (hasPlusPrefix) {
    cleaned = '+' + raw.slice(1).replace(/[^\d]/g, '');
  } else {
    cleaned = raw.replace(/[^\d]/g, '');
  }

  // Strip international prefix (00... or +...) → leave just national digits with country code
  if (hasDoubleZeroPrefix && cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('00')) {
    // Fallback: in case the original had whitespace around "00" that broke the regex
    cleaned = cleaned.slice(2);
  }

  if (!cleaned) return empty;

  const isSerbia: boolean = isSerbiaCountry(country);
  const startsWithSerbiaCode: boolean = cleaned.startsWith('381');
  const hasSerbiaContext: boolean = isSerbia || startsWithSerbiaCode;

  if (hasSerbiaContext) {
    let normalized: string;

    if (startsWithSerbiaCode) {
      normalized = cleaned;
    } else if (cleaned.startsWith('0')) {
      normalized = '381' + cleaned.slice(1);
    } else if (!isInternational && !isSerbia) {
      normalized = cleaned;
    } else {
      normalized = cleaned;
    }

    let phoneType: 'mobile' | 'landline' | 'unknown' = 'unknown';
    if (normalized.startsWith('3816')) {
      phoneType = 'mobile';
    } else if (normalized.startsWith('381') && normalized.length >= 10) {
      phoneType = 'landline';
    }

    if (normalized.length < 7 || normalized.length > 15) {
      return empty;
    }

    const whatsappPhone: string | null =
      phoneType === 'mobile' ? normalized : null;
    const viberPhone: string | null = normalized;

    return {
      normalizedPhone: normalized,
      phoneType,
      whatsappPhone,
      viberPhone,
    };
  }

  if (isInternational && cleaned.length >= 7 && cleaned.length <= 15) {
    return {
      normalizedPhone: cleaned,
      phoneType: 'unknown',
      whatsappPhone: null,
      viberPhone: cleaned,
    };
  }

  if (cleaned.startsWith('0') && !country) {
    return empty;
  }

  if (cleaned.length >= 7 && cleaned.length <= 15) {
    return {
      normalizedPhone: cleaned,
      phoneType: 'unknown',
      whatsappPhone: null,
      viberPhone: null,
    };
  }

  return empty;
}

/**
 * Convenience wrapper used by the chat-link helpers: returns an E.164-style
 * number prefixed with "+" (e.g. "+381641234567"), or '' when no usable
 * number can be derived. Callers strip non-digits before building wa.me /
 * viber.me links.
 */
export function normalizeSerbianPhone(
  phone: string,
  country?: string | null,
): string {
  const result = normalizePhone(phone, country);
  return result.normalizedPhone ? `+${result.normalizedPhone}` : '';
}
