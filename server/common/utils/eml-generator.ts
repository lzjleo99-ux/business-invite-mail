/**
 * Generate a standard RFC822 .eml file content string.
 *
 * @param to - Recipient email address.
 * @param subject - Email subject (UTF-8, may contain non-ASCII characters).
 * @param body - Email body text; line breaks are preserved.
 * @param from - Optional sender in "Display Name <email>" format.
 * @returns Complete .eml file content as a string.
 */
export function generateEml(
  to: string,
  subject: string,
  body: string,
  from?: string,
): string {
  const encodedSubject = encodeRfc2047(subject);

  const lines: string[] = [];

  if (from) {
    lines.push(`From: ${from}`);
  }
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${encodedSubject}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  lines.push(body);

  return lines.join('\r\n');
}

/**
 * Encode a string with RFC 2047 Base64 encoding for mail headers.
 * Returns "=?UTF-8?B?<base64>?=" if the string contains non-ASCII,
 * otherwise returns the original string.
 */
function encodeRfc2047(value: string): string {
  const hasNonAscii = /[^\x20-\x7E]/.test(value);
  if (!hasNonAscii) {
    return value;
  }
  const base64 = Buffer.from(value, 'utf-8').toString('base64');
  return `=?UTF-8?B?${base64}?=`;
}
