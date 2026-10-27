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
  const sigRef = useRef<HTMLTextAreaElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

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
      toast.error(t('保存失败') + ': ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const wrapSelection = (tag: string): void => {
    const el = sigRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = signatureHtml.slice(start, end) || t('文字');
    const next = `${signatureHtml.slice(0, start)}<${tag}>${sel}</${tag}>${signatureHtml.slice(end)}`;
    setSignatureHtml(next);
  };

  const insertImage = async (file: File): Promise<void> => {
    try {
      const { url } = await uploadProfileImage(file);
      const el = sigRef.current;
      const pos = el ? el.selectionStart : signatureHtml.length;
      const img = `<img src="${url}" alt="signature" style="max-width:320px;height:auto" />`;
      setSignatureHtml(`${signatureHtml.slice(0, pos)}${img}${signatureHtml.slice(pos)}`);
      toast.success(t('图片已插入签名'));
    } catch (err: unknown) {
      toast.error(t('上传失败') + ': ' + (err instanceof Error ? err.message : String(err)));
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
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700">{t('邮件签名（支持格式和图片）')}</label>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => wrapSelection('b')} title={t('加粗')}>
                <Bold size={14} />
              </Button>
              <Button variant="outline" size="sm" onClick={() => wrapSelection('i')} title={t('斜体')}>
                <Italic size={14} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => imgInputRef.current?.click()}
                title={t('插入图片')}
              >
                <ImageIcon size={14} />
              </Button>
            </div>
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
          <Textarea
            ref={sigRef}
            value={signatureHtml}
            onChange={(e) => setSignatureHtml(e.target.value)}
            rows={7}
            className="font-mono text-xs"
            placeholder={t('签名会加在邮件末尾。支持 HTML：加粗、斜体、链接、图片。')}
          />
          <p className="text-xs text-slate-400">
            {t('签名在发送时自动附加到每封邮件末尾；修改后立刻对后续发送生效，无需重新生成邮件。')}
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
