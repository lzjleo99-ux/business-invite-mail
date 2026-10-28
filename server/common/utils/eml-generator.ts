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
  opts?: EmlSendOptions,
): string {
  const encodedSubject = encodeRfc2047(subject);

  const lines: string[] = [];

  if (from) {
    lines.push(`From: ${from}`);
  }
  lines.push(`To: ${to}`);
  if (opts?.cc && opts.cc.length > 0) lines.push(`Cc: ${opts.cc.join(', ')}`);
  if (opts?.bcc && opts.bcc.length > 0) lines.push(`Bcc: ${opts.bcc.join(', ')}`);
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

/** 富文本正文哨兵：正文以它开头 = 后面是 HTML（用户在编辑器里排版过） */
export const HTML_BODY_PREFIX = '<!--html-->';

export function isHtmlBody(body: string | null | undefined): boolean {
  return typeof body === 'string' && body.trimStart().startsWith(HTML_BODY_PREFIX);
}

/** HTML 正文 → 纯文本（text/plain 部分用） */
export function htmlBodyToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
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
/** 发送可选附加物：富签名 + 附件（2026-10-27 多发信人档案） */
export interface EmlAttachment {
  filename: string;
  mime: string;
  bytes: Buffer;
}

export interface EmlSendOptions {
  /** 富签名 HTML（用户在发信人档案里编辑的，可含 <img src="cid:...">） */
  signatureHtml?: string;
  /** 签名的纯文本版（拼在 text/plain 部分） */
  signatureText?: string;
  /** 随邮件附上的文件（multipart/mixed 包装） */
  attachments?: EmlAttachment[];
  /** 抄送/密送地址（写入 Cc/Bcc 头；信封收件人由调用方补充） */
  cc?: string[];
  bcc?: string[];
}

export function generateEmlWithImages(
  to: string,
  subject: string,
  body: string,
  from: string | undefined,
  images: EmlInlineImage[],
  opts?: EmlSendOptions,
): string {
  const signatureHtml = opts?.signatureHtml?.trim();
  const signatureText = opts?.signatureText?.trim();
  const attachments = opts?.attachments ?? [];
  // 无图无签名无附件 → 老的纯文本路径
  const hasCcBcc = (opts?.cc?.length ?? 0) > 0 || (opts?.bcc?.length ?? 0) > 0;
  if (images.length === 0 && !signatureHtml && !signatureText && attachments.length === 0 && !hasCcBcc) {
    return generateEml(to, subject, body, from, opts);
  }
  if (images.length === 0 && !signatureHtml && attachments.length === 0) {
    // 只有 cc/bcc（无签名无附件无图）→ 生成简单纯文本 + 头部
    return generateEml(to, subject, body, from, opts);
  }

  const byMaterial = new Map(images.map((img) => [img.materialId, img]));

  const encodedSubject = encodeRfc2047(subject);
  const relatedBoundary = `----=_bid_related_${Date.now().toString(36)}`;
  const altBoundary = `----=_bid_alt_${Date.now().toString(36)}`;

  const plainText =
    (isHtmlBody(body)
      ? htmlBodyToText(body.trimStart().slice(HTML_BODY_PREFIX.length))
      : stripImageMarkerLines(body)) + (signatureText ? `\n\n${signatureText}` : '');
  const html =
    buildHtmlBody(body, byMaterial)
    + (signatureHtml
      ? `<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0">${signatureHtml}</div>`
      : '');

  const lines: string[] = [];
  if (from) lines.push(`From: ${from}`);
  lines.push(`To: ${to}`);
  if (opts?.cc && opts.cc.length > 0) lines.push(`Cc: ${opts.cc.join(', ')}`);
  if (opts?.bcc && opts.bcc.length > 0) lines.push(`Bcc: ${opts.bcc.join(', ')}`);
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

  // 有附件时：整个 related 结构作为 multipart/mixed 的第一部分
  if (attachments.length > 0) {
    const mixedBoundary = `----=_bid_mixed_${Date.now().toString(36)}`;
    const wrapped: string[] = [];
    wrapped.push('Content-Type: multipart/mixed; boundary="' + mixedBoundary + '"');
    wrapped.push('');
    wrapped.push('This is a multi-part message in MIME format.');
    wrapped.push(`--${mixedBoundary}`);
    // related 部分整体内嵌（其内部行需要缩进无关紧要，MIME 只认边界）
    wrapped.push(...lines);
    for (const att of attachments) {
      const safeName = sanitizeAsciiFileName(att.filename, 0) || 'attachment';
      const encodedName = encodeRfc2047(att.filename);
      wrapped.push(`--${mixedBoundary}`);
      wrapped.push(`Content-Type: ${att.mime}; name="${safeName}"`);
      wrapped.push('Content-Transfer-Encoding: base64');
      wrapped.push(`Content-Disposition: attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
      wrapped.push('');
      wrapped.push(chunkBase64(att.bytes.toString('base64')));
      wrapped.push('');
    }
    wrapped.push(`--${mixedBoundary}--`);
    return wrapped.join('\r\n');
  }

  return lines.join('\r\n');
}

/** 正文 → HTML：段落 <p>、标记 → <figure><img src="cid:">、紧随行 → <figcaption>。 */
function buildHtmlBody(body: string, byMaterial: Map<string, EmlInlineImage>): string {
  // 富文本正文（用户在编辑器排版过）：原样使用，只把 [[IMG:...]] 标记换成内嵌图
  if (isHtmlBody(body)) {
    const raw = body.trimStart().slice(HTML_BODY_PREFIX.length);
    const withImages = replaceMaterialImagesInHtml(raw, byMaterial);
    return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1e293b">${replaceImgMarkersInHtml(withImages, byMaterial)}</div>`;
  }
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

/**
 * 富文本正文里的 <img data-material-id="ID"> → CID 内嵌图。
 *
 * 编辑器里插入的是**真实图片元素**（带 data-material-id），用户可以在编辑器里
 * 直接拖拽调整大小（宽度写进 style）；发送时按 materialId 取字节换成 CID 内嵌图，
 * 并**保留用户设定的宽度**——所以"正文里的图"和"附件"是两回事。
 */
function replaceMaterialImagesInHtml(
  html: string,
  byMaterial: Map<string, EmlInlineImage>,
): string {
  return html.replace(/<img\b[^>]*>/gi, (full) => {
    const id = full.match(/data-material-id="([^"]+)"/i)?.[1]?.trim();
    if (!id) return full; // 普通图片（外链等）保持原样
    const img = byMaterial.get(id);
    if (!img) return ''; // 取不到字节 → 去掉这张图（不留坏图）
    const style = full.match(/style="([^"]*)"/i)?.[1] || '';
    const widthMatch = style.match(/width:\s*([\d.]+)(px|%)/i);
    // 用户没设宽度 → 用默认（最大 560px，宽度 100%）；设了就照搬
    const width = widthMatch
      ? `width:${widthMatch[1]}${widthMatch[2]};max-width:100%;`
      : 'max-width:560px;width:100%;';
    const alt = full.match(/alt="([^"]*)"/i)?.[1] || sanitizeAsciiFileName(img.fileName, 0);
    return (
      `<figure style="margin:16px 0;text-align:center">`
      + `<img src="cid:${img.contentId}" alt="${alt}" style="${width}height:auto;border:1px solid #e2e8f0;border-radius:8px" />`
      + `</figure>`
    );
  });
}

/** 富文本正文里的 [[IMG:id]] 段落 → 内嵌图片 figure */
function replaceImgMarkersInHtml(
  html: string,
  byMaterial: Map<string, EmlInlineImage>,
): string {
  let out = html;
  for (const [materialId, img] of byMaterial.entries()) {
    const marker = `[[IMG:${materialId}]]`;
    if (!out.includes(marker)) continue;
    const figure =
      `<figure style="margin:16px 0;text-align:center">`
      + `<img src="cid:${img.contentId}" alt="${sanitizeAsciiFileName(img.fileName, 0)}" style="max-width:560px;width:100%;height:auto;border:1px solid #e2e8f0;border-radius:8px" />`
      + `</figure>`;
    // 标记可能单独成段（<p>[[IMG:x]]</p>）或夹在文本里
    out = out.replace(
      new RegExp(`<p[^>]*>\\s*${marker.replace(/[\[\]]/g, '\\$&')}\\s*</p>`, 'gi'),
      figure,
    );
    out = out.replace(marker, figure);
  }
  return out;
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
