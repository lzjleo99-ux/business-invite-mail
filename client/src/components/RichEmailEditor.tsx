import React, { useEffect, useRef } from 'react';
import { Bold, Italic, Image as ImageIcon } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { useI18n } from '@client/src/i18n';

/**
 * 富文本邮件正文编辑器（与发信人签名同款工具栏）。
 *
 * 正文有两种存储形态：
 * - 纯文本（AI 生成的默认形态）
 * - HTML（用户在编辑器里排版过，存 `<!--html-->` 前缀 + HTML）
 * 本组件对外只认 HTML：传入纯文本会自动转成段落，保存时输出 HTML。
 */

export const HTML_BODY_PREFIX = '<!--html-->';

/** 纯文本 → 可编辑 HTML（每行一段，保留 [[IMG:...]] 标记行） */
export function textToEditorHtml(text: string): string {
  const escaped = (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n/)
    .filter((line, idx, arr) => !(line.trim() === '' && idx === arr.length - 1))
    .map((line) => `<p>${line.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** 去掉 HTML 标签 → 纯文本（存纯文本形态时用；邮件的 text/plain 部分也用它） */
export function editorHtmlToText(html: string): string {
  return (html || '')
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

/** 判断正文是不是富文本形态 */
export function isHtmlBody(body: string | null | undefined): boolean {
  return typeof body === 'string' && body.trimStart().startsWith(HTML_BODY_PREFIX);
}

/** 取出富文本正文里的 HTML（去掉前缀） */
export function stripHtmlPrefix(body: string): string {
  return isHtmlBody(body) ? body.trimStart().slice(HTML_BODY_PREFIX.length) : '';
}

export interface RichEmailEditorProps {
  /** 原始正文（纯文本或 HTML 形态） */
  value: string;
  onChange: (nextHtml: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
  /** 外部请求在光标处插入 HTML（nonce 变化即触发一次插入） */
  insertRequest?: { html: string; nonce: number } | null;
}

const RichEmailEditor: React.FC<RichEmailEditorProps> = ({
  value,
  onChange,
  placeholder,
  className,
  minHeight = 320,
  insertRequest,
}) => {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const loadedRef = useRef<string | null>(null);

  // 外部值变化时写入编辑器（仅当内容确实不同，避免光标跳走）
  // 约定：**value 永远是 HTML**（纯文本由调用方先转成段落 HTML）。
  // 之前在这里做"不是 HTML 就转义"，导致编辑器回写出来的 HTML 被二次转义，
  // 页面上就是一串 <p>&lt;p&gt;… 的乱码。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = isHtmlBody(value) ? stripHtmlPrefix(value) : value;
    if (loadedRef.current === html) return;
    if (el.innerHTML !== html) {
      el.innerHTML = html;
      loadedRef.current = html;
    }
  }, [value]);

  const keepSelection = (fn: () => void): void => {
    const el = ref.current;
    el?.focus();
    const sel = window.getSelection();
    if (savedRangeRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    fn();
    savedRangeRef.current = null;
  };

  const emit = (): void => {
    const el = ref.current;
    if (!el) return;
    loadedRef.current = el.innerHTML;
    onChange(el.innerHTML);
  };

  const insertAtCursor = (html: string): void => {
    keepSelection(() => document.execCommand('insertHTML', false, html));
    emit();
  };

  // 外部插入请求（例如插入项目图片标记）
  useEffect(() => {
    if (!insertRequest || !insertRequest.html) return;
    insertAtCursor(insertRequest.html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRequest?.nonce]);

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      {/* 工具栏（与签名一致） */}
      <div className="flex flex-wrap items-center gap-1 rounded-t-md border-b border-slate-200 bg-slate-50 px-2 py-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => keepSelection(() => document.execCommand('bold'))}
          title={t('加粗')}
        >
          <Bold size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => keepSelection(() => document.execCommand('italic'))}
          title={t('斜体')}
        >
          <Italic size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-sm font-semibold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => keepSelection(() => document.execCommand('underline'))}
          title={t('下划线')}
        >
          U
        </Button>
        <select
          className="h-7 rounded border border-slate-200 bg-white px-1 text-xs"
          onMouseDown={(e) => e.preventDefault()}
          onChange={(e) => keepSelection(() => document.execCommand('fontName', false, e.target.value))}
          defaultValue=""
        >
          <option value="">{t('字体')}</option>
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Helvetica">Helvetica</option>
          <option value="Verdana">Verdana</option>
          <option value="SimSun">{t('宋体')}</option>
          <option value="Microsoft YaHei">{t('微软雅黑')}</option>
        </select>
        <select
          className="h-7 rounded border border-slate-200 bg-white px-1 text-xs"
          onMouseDown={(e) => e.preventDefault()}
          onChange={(e) => keepSelection(() => document.execCommand('fontSize', false, e.target.value))}
          defaultValue=""
        >
          <option value="">{t('字号')}</option>
          <option value="1">10px</option>
          <option value="2">13px</option>
          <option value="3">16px</option>
          <option value="4">18px</option>
          <option value="5">24px</option>
          <option value="6">32px</option>
        </select>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onMouseUp={() => {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0);
        }}
        onKeyUp={() => {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0);
        }}
        className={`rounded-b-md px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-blue-400 ${className || ''}`}
        style={{ minHeight }}
      />
    </div>
  );
};

export default RichEmailEditor;
