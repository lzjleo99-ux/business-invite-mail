/**
 * 邮件正文里的图片标记工具。
 *
 * 生成邮件时模型在正文里插入 `[[IMG:<素材ID>]]` 标记（独占一行），
 * 其紧随的第一个非空行作为图注。标记是正文的组成部分（编辑器里可见可改），
 * 展示态渲染成内联图片；复制纯文本 / mailto 时去掉标记行、保留图注。
 */

const IMAGE_MARKER_LINE_RE = /^\s*\[\[IMG:([^\]\n]+)\]\]\s*$/;

export type EmailBodySegment =
  | { type: 'text'; text: string }
  | { type: 'image'; materialId: string; caption: string };

/** 正文切段：标记行 → image 段（带图注），其余连续行 → text 段。 */
export function parseEmailBody(body: string): EmailBodySegment[] {
  const lines = body.split('\n');
  const segments: EmailBodySegment[] = [];
  let textBuf: string[] = [];
  const flush = (): void => {
    if (textBuf.length > 0) {
      segments.push({ type: 'text', text: textBuf.join('\n') });
      textBuf = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(IMAGE_MARKER_LINE_RE);
    if (m) {
      flush();
      // 图注 = 标记后第一个非空且非标记的行
      let caption = '';
      let consumed = i;
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (!t) continue;
        if (!IMAGE_MARKER_LINE_RE.test(lines[j])) {
          caption = t;
          consumed = j;
        }
        break;
      }
      segments.push({ type: 'image', materialId: m[1].trim(), caption });
      i = consumed;
    } else {
      textBuf.push(lines[i]);
    }
  }
  flush();
  return segments;
}

/** 去掉标记行（图注保留为普通文本行）——复制/mailto 等纯文本场景用。 */
export function stripImageMarkers(body: string): string {
  return body
    .split('\n')
    .filter((line) => !IMAGE_MARKER_LINE_RE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hasImageMarkers(body: string): boolean {
  return /\[\[IMG:[^\]\n]+\]\]/.test(body);
}
