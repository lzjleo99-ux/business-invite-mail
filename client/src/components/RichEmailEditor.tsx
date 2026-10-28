import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bold, Italic, Image as ImageIcon, Trash2 } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { useI18n } from '@client/src/i18n';

/**
 * 富文本邮件正文编辑器（与发信人签名同款工具栏）。
 *
 * 正文有两种存储形态：
 * - 纯文本（AI 生成的默认形态）
 * - HTML（用户在编辑器里排版过，存 `<!--html-->` 前缀 + HTML）
 * 本组件对外只认 HTML：传入纯文本会自动转成段落，保存时输出 HTML。
 *
 * 图片：编辑器里插的是**真实 <img>**（带 data-material-id），所以
 * - 用户可以点选后拖右侧手柄改大小（宽度写进 style，发送时保留）
 * - 发送时服务端按 materialId 取字节换成 CID 内嵌图（不是附件）
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

/**
 * 生成正文里的图片元素（真实图片，可缩放）。
 * src 用对象 URL 供编辑器预览；服务端只认 data-material-id，src 会被换成 CID。
 */
export function buildMaterialImageHtml(
  materialId: string,
  src: string,
  caption?: string,
  width = 420,
): string {
  const img =
    `<img data-material-id="${materialId}" src="${src}" alt="" `
    + `style="width:${width}px;max-width:100%;height:auto;border:1px solid #e2e8f0;border-radius:8px;margin:4px 0" />`;
  const cap = caption
    ? `<p style="font-size:12px;color:#64748b;margin:2px 0 0">${caption}</p>`
    : '';
  return `<p style="text-align:center;margin:8px 0">${img}</p>${cap}`;
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

interface SelectedImage {
  el: HTMLImageElement;
  /** 相对编辑器容器的位置（用于放拖拽手柄） */
  box: { top: number; left: number; width: number; height: number };
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const loadedRef = useRef<string | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [selected, setSelected] = useState<SelectedImage | null>(null);

  // 外部值变化时写入编辑器（仅当内容确实不同，避免光标跳走）
  // 约定：**value 永远是 HTML**（纯文本由调用方先转成段落 HTML）。
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

  const emit = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    loadedRef.current = el.innerHTML;
    onChange(el.innerHTML);
  }, [onChange]);

  const insertAtCursor = (html: string): void => {
    keepSelection(() => document.execCommand('insertHTML', false, html));
    emit();
  };

  // 外部插入请求（例如插入项目图片）
  useEffect(() => {
    if (!insertRequest || !insertRequest.html) return;
    insertAtCursor(insertRequest.html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRequest?.nonce]);

  /** 计算图片相对编辑器容器的位置 */
  const measure = useCallback((img: HTMLImageElement): SelectedImage | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const a = img.getBoundingClientRect();
    const b = wrap.getBoundingClientRect();
    return {
      el: img,
      box: {
        top: a.top - b.top + wrap.scrollTop,
        left: a.left - b.left + wrap.scrollLeft,
        width: a.width,
        height: a.height,
      },
    };
  }, []);

  /** 点击编辑器：选中图片（用于调尺寸）或取消选中 */
  const handleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      const img = target as HTMLImageElement;
      setSelected(measure(img));
      return;
    }
    setSelected(null);
  };

  /** 设定宽度（百分比或像素）；null = 恢复自适应 */
  const applyWidth = (width: string | null): void => {
    const img = selected?.el;
    if (!img) return;
    if (width === null) {
      img.style.width = '';
      img.removeAttribute('width');
    } else {
      img.style.width = width;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    }
    emit();
    setSelected(measure(img));
  };

  /** 拖拽手柄：改宽度 */
  const startDrag = (e: React.MouseEvent<HTMLDivElement>): void => {
    const img = selected?.el;
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startWidth: img.getBoundingClientRect().width };
    const onMove = (ev: MouseEvent): void => {
      const st = dragRef.current;
      if (!st) return;
      const next = Math.max(80, Math.round(st.startWidth + (ev.clientX - st.startX)));
      img.style.width = `${next}px`;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      setSelected(measure(img));
    };
    const onUp = (): void => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      emit();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** Delete 删除选中的图片 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!selected || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    const inImage =
      node === selected.el
      || (node ? selected.el.contains(node) : false)
      || (node && sel.anchorOffset < node.childNodes.length
        ? node.childNodes[sel.anchorOffset] === selected.el
        : false);
    if (!inImage) return;
    e.preventDefault();
    selected.el.remove();
    setSelected(null);
    emit();
  };

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

        {/* 选中图片后的尺寸控制 */}
        {selected && (
          <>
            <span className="mx-1 h-4 w-px bg-slate-300" />
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <ImageIcon size={12} />
              {t('图片尺寸')}
            </span>
            {[
              ['25%', '25%'],
              ['50%', '50%'],
              ['75%', '75%'],
              ['100%', '100%'],
            ].map(([label, w]) => (
              <Button
                key={w}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyWidth(w)}
              >
                {label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyWidth(null)}
            >
              {t('自适应')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-red-500 hover:bg-red-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                selected.el.remove();
                setSelected(null);
                emit();
              }}
              title={t('删除图片')}
            >
              <Trash2 size={13} />
            </Button>
          </>
        )}
      </div>

      <div ref={wrapRef} className="relative">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={emit}
          onBlur={emit}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
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
        {/* 拖拽手柄：拖动改图片宽度 */}
        {selected && (
          <div
            role="presentation"
            onMouseDown={startDrag}
            title={t('拖动调整图片大小')}
            className="absolute z-10 h-6 w-3 cursor-ew-resize rounded-sm border border-white bg-blue-500 shadow"
            style={{
              top: `${selected.box.top + selected.box.height / 2 - 12}px`,
              left: `${selected.box.left + selected.box.width - 5}px`,
            }}
          />
        )}
      </div>
      {selected && (
        <p className="border-t border-slate-100 px-3 py-1 text-xs text-slate-400">
          {t('已选中图片：可点上方比例按钮，或拖动右侧蓝色手柄调整大小；按 Delete 删除。')}
        </p>
      )}
    </div>
  );
};

export default RichEmailEditor;
