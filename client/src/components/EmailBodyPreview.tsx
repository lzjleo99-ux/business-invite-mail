import React, { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { getMaterialObjectUrl } from '@client/src/api/projects';
import { useI18n } from '@client/src/i18n';

/**
 * 邮件正文预览：把正文里的 [[IMG:materialId]] 标记换成**真实图片**，
 * 让用户在编辑器旁就能看到"图片已经在正文里"（发送时同样位置内嵌）。
 */
export interface EmailBodyPreviewProps {
  /** HTML 正文（含 [[IMG:...]] 标记） */
  html: string;
  projectId: string;
}

const MARKER_RE = /\[\[IMG:([0-9a-f-]{36})\]\]/gi;

const EmailBodyPreview: React.FC<EmailBodyPreviewProps> = ({ html, projectId }) => {
  const { t } = useI18n();
  const [urls, setUrls] = useState<Record<string, string>>({});

  const ids = useMemo(() => {
    const found: string[] = [];
    for (const m of String(html || '').matchAll(MARKER_RE)) {
      if (!found.includes(m[1])) found.push(m[1]);
    }
    // 编辑器插入的真实图片：<img data-material-id="ID">（src 存的是当时的
    // 对象 URL，刷新后失效 → 预览时换成新的对象 URL）
    for (const m of String(html || '').matchAll(/data-material-id="([^"]+)"/g)) {
      if (!found.includes(m[1])) found.push(m[1]);
    }
    return found;
  }, [html]);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const id of ids) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const u = await getMaterialObjectUrl(projectId, id);
          created.push(u);
          next[id] = u;
        } catch {
          /* 取不到就跳过，不影响其他图 */
        }
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
      for (const u of created) URL.revokeObjectURL(u);
    };
  }, [ids, projectId]);

  const rendered = useMemo(() => {
    let out = String(html || '');
    // 真实图片元素：src 换成当前有效的对象 URL
    out = out.replace(/<img\b([^>]*?)data-material-id="([^"]+)"([^>]*)>/gi,
      (_m, before: string, id: string, after: string) => {
        const url = urls[id];
        if (!url) return `${before}data-material-id="${id}"${after}`;
        const style = `${before} ${after}`.match(/style="([^"]*)"/i)?.[1] || '';
        const width = style.match(/width:\s*([\d.]+)(px|%)/i)?.[0] || '';
        return `<img data-material-id="${id}" src="${url}" alt="" `
          + `style="${width ? `${width};` : ''}max-width:100%;height:auto;`
          + 'border:1px solid #e2e8f0;border-radius:8px;margin:8px 0" />';
      });
    out = out.replace(
      /<p[^>]*>\s*\[\[IMG:([0-9a-f-]{36})\]\]\s*<\/p>/gi,
      (_m, id: string) =>
        urls[id]
          ? `<img src="${urls[id]}" alt="" style="max-width:520px;width:100%;height:auto;border:1px solid #e2e8f0;border-radius:8px;margin:8px 0" />`
          : '<span style="color:#94a3b8">[图片载入中…]</span>',
    );
    out = out.replace(MARKER_RE, (_m, id: string) =>
      urls[id]
        ? `<img src="${urls[id]}" alt="" style="max-width:520px;width:100%;height:auto;border:1px solid #e2e8f0;border-radius:8px;margin:8px 0" />`
        : '<span style="color:#94a3b8">[图片载入中…]</span>',
    );
    return out;
  }, [html, urls]);

  if (!html.trim()) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 flex items-center gap-1 text-xs font-medium text-slate-500">
        <ImageIcon size={12} />
        {t('正文预览（图片已嵌入正文，不是附件）')}
      </p>
      <div
        className="email-body-html text-sm leading-relaxed text-slate-700"
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </div>
  );
};

export default EmailBodyPreview;
