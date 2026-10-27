import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Star, Loader2, Image as ImageIcon, Bold, Italic } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  setDefaultProfile,
  uploadProfileImage,
  type SenderProfile,
} from '@client/src/api/sender-profiles';
import { useI18n } from '@client/src/i18n';
import { uploadSizeError } from '@client/src/utils/upload-guard';
import { errMessage } from '@client/src/utils/err-message';

/**
 * 发信人档案管理（多身份）：每个档案 = 姓名/职位/公司 + 富签名（可插图、可加粗斜体）。
 * 发送时（一键发送/单发）选择用哪个档案；改档案不影响别人（每用户独立）。
 */
const SenderProfilesTab: React.FC = () => {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<SenderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SenderProfile | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderTitle, setSenderTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [signatureHtml, setSignatureHtml] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const sigRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);

  /** 工具栏按钮按下时不抢焦点（否则 Windows 下选区丢失、插入位置错乱） */
  const keepSelection = (fn: () => void): void => {
    const el = sigRef.current;
    el?.focus();
    const sel = window.getSelection();
    if (savedRangeRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    fn();
    savedRangeRef.current = null;
  };

  /** 光标处插入 HTML（无选区时追加到末尾） */
  const insertAtCursor = (html: string): void => {
    const el = sigRef.current;
    el?.focus();
    const sel = window.getSelection();
    if (savedRangeRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    document.execCommand('insertHTML', false, html);
    savedRangeRef.current = null;
  };

  /** 同步 contentEditable 内容（编辑会话初始化时用一次） */
  useEffect(() => {
    if (editing && sigRef.current) {
      sigRef.current.innerHTML = signatureHtml;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const reload = async (): Promise<void> => {
    setLoading(true);
    try {
      setProfiles(await listProfiles());
    } catch {
      toast.error(t('加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const startNew = (): void => {
    setEditing('new');
    setProfileName('');
    setSenderName('');
    setSenderTitle('');
    setCompanyName('');
    setSignatureHtml('');
    setIsDefault(profiles.length === 0);
  };

  const startEdit = (p: SenderProfile): void => {
    setEditing(p);
    setProfileName(p.profileName);
    setSenderName(p.senderName);
    setSenderTitle(p.senderTitle || '');
    setCompanyName(p.companyName || '');
    setSignatureHtml(p.signatureHtml || '');
    setIsDefault(p.isDefault);
  };

  const save = async (): Promise<void> => {
    if (!profileName.trim() || !senderName.trim()) {
      toast.error(t('档案名和发件人姓名不能为空'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        profileName,
        senderName,
        senderTitle: senderTitle || null,
        companyName: companyName || null,
        signatureHtml,
        isDefault,
      };
      const htmlOut = sigRef.current?.innerHTML ?? signatureHtml;
      payload.signatureHtml = htmlOut;
      if (editing === 'new') {
        await createProfile(payload);
      } else if (editing) {
        await updateProfile(editing.id, payload);
        if (isDefault && !editing.isDefault) await setDefaultProfile(editing.id);
      }
      toast.success(t('已保存'));
      setEditing(null);
      await reload();
    } catch (err: unknown) {
      toast.error(errMessage(err, t('保存失败')));
    } finally {
      setSaving(false);
    }
  };


  const insertImage = async (file: File): Promise<void> => {
    const sizeErr = uploadSizeError(file);
    if (sizeErr) {
      toast.error(sizeErr);
      return;
    }
    try {
      const { url } = await uploadProfileImage(file);
      insertAtCursor(
        `<img src="${url}" alt="signature" style="max-width:320px;height:auto;margin:4px 0" draggable="true" />`,
      );
      toast.success(t('图片已插入签名'));
    } catch (err: unknown) {
      toast.error(errMessage(err, t('上传失败')));
    }
  };

  const remove = async (p: SenderProfile): Promise<void> => {
    try {
      await deleteProfile(p.id);
      toast.success(t('已删除'));
      await reload();
    } catch {
      toast.error(t('删除失败'));
    }
  };

  const makeDefault = async (p: SenderProfile): Promise<void> => {
    try {
      await setDefaultProfile(p.id);
      toast.success(t('已设为默认发信人'));
      await reload();
    } catch {
      toast.error(t('设置默认失败'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  // 编辑视图
  if (editing) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">{t('档案名')}</label>
            <Input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder={t('例如：Zijian - Global Sourcing')}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">{t('发件人姓名')}</label>
            <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Zijian Lang" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">{t('职位 / 头衔')}</label>
            <Input
              value={senderTitle}
              onChange={(e) => setSenderTitle(e.target.value)}
              placeholder="Global Sourcing Specialist"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">{t('公司名')}</label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="" />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">{t('邮件签名（所见即所得编辑）')}</label>
          {/* 工具栏：加粗/斜体/下划线 + 字体 + 字号 + 插图（可拖动排版） */}
          <div className="flex flex-wrap items-center gap-1 rounded-t-md border border-b-0 border-slate-200 bg-slate-50 px-2 py-1">
            <Button
              variant="ghost" size="sm" className="h-7 px-2"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => keepSelection(() => document.execCommand('bold'))}
              title={t('加粗')}
            >
              <Bold size={14} />
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 px-2"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => keepSelection(() => document.execCommand('italic'))}
              title={t('斜体')}
            >
              <Italic size={14} />
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 px-2 text-sm font-semibold"
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
            <Button
              variant="ghost" size="sm" className="h-7 px-2"
              onClick={() => imgInputRef.current?.click()}
              title={t('插入图片（可在编辑区内拖动排版）')}
            >
              <ImageIcon size={14} />
            </Button>
          </div>
          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void insertImage(f);
              e.target.value = '';
            }}
          />
          {/* 所见即所得编辑区：图片可直接拖动排版；保存时读 innerHTML */}
          <div
            ref={sigRef}
            contentEditable
            suppressContentEditableWarning
            onMouseUp={() => {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0);
            }}
            onKeyUp={() => {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0);
            }}
            className="min-h-[120px] rounded-b-md border border-slate-200 bg-white p-3 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <p className="text-xs text-slate-400">
            {t('图片操作：单击选中图片后按 Delete 删除；误删可 Ctrl+Z 撤销；拖动图片可排版。')}
          </p>
          <p className="text-xs text-slate-400">
            {t('签名在发送时自动附加到每封邮件末尾；图片可以直接拖动排版。修改后立刻对后续发送生效。')}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="accent-blue-600"
          />
          {t('设为默认发信人（发送时不选即用默认）')}
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEditing(null)}>
            {t('取消')}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" size={16} />}
            {t('保存')}
          </Button>
        </div>
      </div>
    );
  }

  // 列表视图
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {t(
            '发信人档案 = 随邮件发出的身份与签名。可建多个（例如不同业务线各一个），发送时选择用哪个。',
          )}
        </p>
        <Button size="sm" onClick={startNew}>
          <Plus size={15} />
          {t('新建档案')}
        </Button>
      </div>

      {profiles.length === 0 ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('还没有发信人档案。新建一个后，生成的邮件会自动带上你的签名。')}
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  {p.profileName}
                  {p.isDefault && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">
                      {t('默认')}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {p.senderName}
                  {p.senderTitle ? ` · ${p.senderTitle}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {!p.isDefault && (
                  <Button variant="ghost" size="sm" onClick={() => void makeDefault(p)} title={t('设为默认')}>
                    <Star size={14} />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>
                  {t('编辑')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:bg-red-50 hover:text-red-600"
                  onClick={() => void remove(p)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SenderProfilesTab;
