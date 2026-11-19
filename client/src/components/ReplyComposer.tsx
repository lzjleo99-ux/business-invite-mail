import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Paperclip, Send, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import RichEmailEditor from '@client/src/components/RichEmailEditor';
import { useI18n } from '@client/src/i18n';
import {
  getReplyDraft,
  sendEmailReply,
  type EmailHistoryDetail,
} from '@client/src/api/email-generator';
import {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  type EmailAttachment,
} from '@client/src/api/sender-profiles';

interface Props {
  /** 要回复的往来记录 id */
  historyId: string | null;
  /** 原邮件详情（用于拿到公司 id 以便上传附件） */
  detail: EmailHistoryDetail | null;
  onClose: () => void;
  onSent?: () => void;
}

/**
 * 邮件回复编辑器（参考 Gmail / RainLoop 的回复体验）：
 * - 打开时拉取服务端生成的回复草稿（Re: 主题 + To 回填 + 引用原文模板）
 * - 正文富文本可编辑；引用原文只读附在下方
 * - 附件复用「每公司附件表」，与撰写页共享
 * - 发送走 histories/:id/reply，用调用者自己的 SMTP，自动记录 outbound 往来
 */
const ReplyComposer: React.FC<Props> = ({ historyId, detail, onClose, onSent }) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [attBusy, setAttBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const companyId = detail?.companyId ?? null;

  useEffect(() => {
    if (!historyId) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const draft = await getReplyDraft(historyId);
        if (!alive) return;
        setSubject(draft.subject);
        setTo(draft.to);
        // 原邮件正文直接放进可编辑区：用户能在同一个编辑器里写新回复 + 改原文，
        // 符合正常邮件客户端回复体验（引用原文可编辑）。
        const quoteHtml = draft.quoted
          ? `<p><br/></p><hr style=\"border:0;border-top:1px solid #ccc;margin:12px 0\" /><div style=\"color:#666;font-size:12px\">${draft.quoted
              .split('\n')
              .map((line) => (line ? `<div>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : '<div><br/></div>'))
              .join('')}</div>`
          : '';
        setBodyHtml(`<p><br/></p>${quoteHtml}`);
      } catch (err: unknown) {
        if (alive) toast.error(err instanceof Error ? err.message : t('加载回复模板失败'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [historyId, t]);

  // 附件列表（与撰写页同一张表）
  useEffect(() => {
    if (!companyId) return;
    void listAttachments(companyId)
      .then(setAttachments)
      .catch(() => setAttachments([]));
  }, [companyId]);

  const handleUpload = async (file: File | undefined): Promise<void> => {
    if (!file || !companyId) return;
    setAttBusy(true);
    try {
      await uploadAttachment(companyId, file);
      setAttachments(await listAttachments(companyId));
      toast.success(t('附件已添加'));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('附件上传失败'));
    } finally {
      setAttBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDeleteAttachment = async (id: string): Promise<void> => {
    try {
      await deleteAttachment(id);
      if (companyId) setAttachments(await listAttachments(companyId));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('附件删除失败'));
    }
  };

  /** 富文本 HTML → 纯文本（后端模板会把这段作为用户回复正文，引用原文附在后面） */
  const htmlToText = (html: string): string => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  };

  const handleSend = async (): Promise<void> => {
    if (!historyId || sending) return;
    const text = htmlToText(bodyHtml);
    if (!text) {
      toast.error(t('请填写回复正文'));
      return;
    }
    if (!to.trim()) {
      toast.error(t('收件人不能为空'));
      return;
    }
    setSending(true);
    try {
      const result = await sendEmailReply(historyId, {
        body: text,
        subject,
        to,
        cc: cc || undefined,
      });
      toast.success(t('回复已发送至 {email}', { email: result.to }));
      onSent?.();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('回复发送失败'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!historyId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('回复邮件')}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-slate-500">
            <Loader2 className="animate-spin mr-2" size={16} />
            {t('正在加载回复模板...')}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[80px,minmax(0,1fr)] items-center gap-2 text-sm">
              <label className="text-slate-500">{t('收件人')}</label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-sm" />
              <label className="text-slate-500">CC</label>
              <Input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder={t('可选，多个地址用逗号分隔')}
                className="h-8 text-sm"
              />
              <label className="text-slate-500">{t('主题')}</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-8 text-sm" />
            </div>

            {/* 可编辑的回复正文 */}
            <div className="rounded-md border border-slate-200">
              <RichEmailEditor
                value={bodyHtml}
                onChange={setBodyHtml}
                minHeight={160}
                placeholder={t('在此输入回复内容...')}
              />
            </div>

            {/* 附件：与撰写页共用每公司附件表 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => void handleUpload(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!companyId || attBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  {attBusy ? <Loader2 className="animate-spin" size={14} /> : <Paperclip size={14} />}
                  {t('附加文件')}
                </Button>
                {!companyId && (
                  <span className="text-xs text-slate-400">
                    {t('该邮件未关联公司，无法使用附件')}
                  </span>
                )}
              </div>
              {attachments.length > 0 && (
                <ul className="space-y-1">
                  {attachments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs text-slate-600"
                    >
                      <span className="truncate">{a.filename}</span>
                      <button
                        type="button"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => void handleDeleteAttachment(a.id)}
                        aria-label={t('删除附件')}
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                {t('取消')}
              </Button>
              <Button onClick={() => void handleSend()} disabled={sending}>
                {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                {t('发送回复')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ReplyComposer;
