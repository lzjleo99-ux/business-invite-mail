export interface NormalizePhoneResult {
  normalizedPhone: string | null;
  phoneType: 'mobile' | 'landline' | 'unknown';
  whatsappPhone: string | null;
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

/**
 * Normalize a phone number to pure digits with country code.
 * Handles Serbian numbers specifically; basic normalization for others.
 */
export function normalizePhone(
  phone: string,
  country?: string | null,
): NormalizePhoneResult {
  if (!phone || typeof phone !== 'string') {
    return { normalizedPhone: null, phoneType: 'unknown', whatsappPhone: null };
  }

  const raw = phone.trim();
  if (!raw) {
    return { normalizedPhone: null, phoneType: 'unknown', whatsappPhone: null };
  }

  // Detect leading + for country code
  const hasPlus = raw.startsWith('+');

  // Clean: remove spaces, hyphens, parentheses
  // Keep the leading + indicator via hasPlus flag
  let digits = raw.replace(/[\s\-()]/g, '');

  // Remove leading + if present (we already tracked it)
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }

  // Remove any remaining non-digit characters
  digits = digits.replace(/\D/g, '');

  if (!digits) {
    return { normalizedPhone: null, phoneType: 'unknown', whatsappPhone: null };
  }

  const isSerbia = isSerbiaCountry(country);
  const startsWithSerbiaCode = digits.startsWith('381');
  const hasSerbiaContext = isSerbia || startsWithSerbiaCode;

  if (hasSerbiaContext) {
    // Serbian number handling
    let normalized: string;

    if (startsWithSerbiaCode) {
      // Already has country code
      normalized = digits;
    } else if (digits.startsWith('0') && (digits.length === 10 || digits.length === 11)) {
      // Local number starting with 0 (e.g. 065 3711110 -> 10 digits, or 011 8403331 -> 9? let's check)
      // 065 + 7 digits = 10 total
      // 011 + 7 digits = 9 total... but user says 10/11
      // Actually let's be more lenient: if it starts with 0 and no country code, add 381
      normalized = '381' + digits.slice(1);
    } else if (digits.startsWith('0')) {
      // Shorter or longer local number — still try to normalize
      normalized = '381' + digits.slice(1);
    } else if (!hasPlus && !isSerbia) {
      // No clear indication it's Serbian despite prefix match being unlikely
      normalized = digits;
    } else {
      normalized = digits;
    }

    // Determine phone type for Serbian numbers
    // 381 + 6x + 7 digits = mobile (starts with 3816, total length 11-12)
    // 381 + area code (e.g. 11, 21, 24, 34) + local = landline
    let phoneType: 'mobile' | 'landline' | 'unknown' = 'unknown';
    if (normalized.startsWith('3816')) {
      phoneType = 'mobile';
    } else if (normalized.startsWith('381') && normalized.length >= 10) {
      phoneType = 'landline';
    }

    // Length sanity check
    if (normalized.length < 7 || normalized.length > 15) {
      return { normalizedPhone: null, phoneType: 'unknown', whatsappPhone: null };
    }

    const whatsappPhone = phoneType === 'mobile' ? normalized : null;
    return { normalizedPhone: normalized, phoneType, whatsappPhone };
  }

  // Generic / other countries
  if (hasPlus && digits.length >= 7 && digits.length <= 15) {
    // Has explicit + country code, keep as-is
    return {
      normalizedPhone: digits,
      phoneType: 'unknown',
      whatsappPhone: null,
    };
  }

  if (digits.startsWith('0') && !country) {
    // No country info, can't normalize — mark unknown
    return {
      normalizedPhone: null,
      phoneType: 'unknown',
      whatsappPhone: null,
    };
  }

  // Has country but no special handling — return digits as-is with unknown type
  if (digits.length >= 7 && digits.length <= 15) {
    return {
      normalizedPhone: digits,
      phoneType: 'unknown',
      whatsappPhone: null,
    };
  }

  return { normalizedPhone: null, phoneType: 'unknown', whatsappPhone: null };
}
