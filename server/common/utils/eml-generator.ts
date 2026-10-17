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

/** 去掉正文中的图片标记行（复制纯文本 / mailto 场景用；图注文字保留）。 */
export function stripImageMarkerLines(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^\s*\[\[IMG:[^\]\n]+\]\]\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 需要内嵌进 EML 的一张图片。 */
export interface EmlInlineImage {
  /** 对应正文标记里的 materialId */
  materialId: string;
  /** Content-ID（不含尖括号），如 "img-<uuid>@bid" */
  contentId: string;
  /** 原始文件名（做 ASCII 清洗后放进 name/filename 参数） */
  fileName: string;
  contentType: string;
  data: Buffer;
}

/**
 * 带内嵌图片的 .eml：multipart/related{ multipart/alternative{text/plain, text/html}, image... }。
 *
 * 正文标记 [[IMG:<materialId>]] 在 HTML 里变成 <figure><img src="cid:..."></figure>，
 * 其紧随的下一行作为图注（figcaption）；纯文本 alternative 里只去掉标记行。
 * images 为空时退回纯文本版本（向后兼容，不带图的老邮件路径不变）。
 */
export function generateEmlWithImages(
  to: string,
  subject: string,
  body: string,
  from: string | undefined,
  images: EmlInlineImage[],
): string {
  if (images.length === 0) {
    return generateEml(to, subject, body, from);
  }

  const byMaterial = new Map(images.map((img) => [img.materialId, img]));

  const encodedSubject = encodeRfc2047(subject);
  const relatedBoundary = `----=_bid_related_${Date.now().toString(36)}`;
  const altBoundary = `----=_bid_alt_${Date.now().toString(36)}`;

  const plainText = stripImageMarkerLines(body);
  const html = buildHtmlBody(body, byMaterial);

  const lines: string[] = [];
  if (from) lines.push(`From: ${from}`);
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${encodedSubject}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"; type="multipart/alternative"`);
  lines.push('');
  lines.push('This is a multi-part message in MIME format.');
  lines.push(`--${relatedBoundary}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  lines.push('');
  lines.push(`--${altBoundary}`);
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  lines.push(plainText);
  lines.push(`--${altBoundary}`);
  lines.push('Content-Type: text/html; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  lines.push(html);
  lines.push(`--${altBoundary}--`);
  lines.push('');

  images.forEach((img, index) => {
    const safeName = sanitizeAsciiFileName(img.fileName, index);
    lines.push(`--${relatedBoundary}`);
    lines.push(`Content-Type: ${img.contentType}; name="${safeName}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-ID: <${img.contentId}>`);
    lines.push(`Content-Disposition: inline; filename="${safeName}"`);
    lines.push('');
    lines.push(chunkBase64(img.data.toString('base64')));
    lines.push('');
  });
  lines.push(`--${relatedBoundary}--`);

  return lines.join('\r\n');
}

/** 正文 → HTML：段落 <p>、标记 → <figure><img src="cid:">、紧随行 → <figcaption>。 */
function buildHtmlBody(body: string, byMaterial: Map<string, EmlInlineImage>): string {
  const out: string[] = [];
  const esc = (s: string): string => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const rawLines = body.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();
    const marker = trimmed.match(/^\[\[IMG:([^\]\n]+)\]\]$/);
    if (marker && byMaterial.has(marker[1].trim())) {
      const img = byMaterial.get(marker[1].trim()) as EmlInlineImage;
      // 图注 = 标记后第一个非空行
      let caption = '';
      for (let j = i + 1; j < rawLines.length; j++) {
        const next = rawLines[j].trim();
        if (!next) continue;
        if (!/^\[\[IMG:/.test(next)) caption = next;
        break;
      }
      out.push(
        `<figure style="margin:16px 0;text-align:center">`
        + `<img src="cid:${img.contentId}" alt="${esc(sanitizeAsciiFileName(img.fileName, 0))}" style="max-width:560px;width:100%;height:auto;border:1px solid #e2e8f0;border-radius:8px" />`
        + (caption
          ? `<figcaption style="font-size:12px;color:#64748b;margin-top:6px">${esc(caption)}</figcaption>`
          : '')
        + `</figure>`,
      );
      continue;
    }
    if (!trimmed) continue;
    out.push(`<p style="margin:0 0 12px;white-space:pre-wrap">${esc(line)}</p>`);
  }
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1e293b">${out.join('\n')}</div>`;
}

/** 文件名参数只允许 ASCII：非 ASCII 文件名退回 image<N>.<ext>。 */
function sanitizeAsciiFileName(fileName: string, index: number): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '').trim();
  if (ascii) return ascii.slice(0, 80);
  const ext = (fileName.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'jpg').toLowerCase();
  return `image${index + 1}.${ext}`;
}

/** base64 按 76 字符折行（RFC 2045）。 */
function chunkBase64(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
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
