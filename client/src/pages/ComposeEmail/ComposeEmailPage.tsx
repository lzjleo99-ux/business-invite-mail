import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  Home,
  ChevronRight,
  Copy,
  Download,
  Mail,
  MessageCircle,
  Save,
  Send,
  Plus,
  Trash2,
  Loader2,
  Phone,
  Building2,
} from 'lucide-react';

import * as restaurantsApi from '@client/src/api/restaurants';
import * as emailGeneratorApi from '@client/src/api/email-generator';
import RichEmailEditor, { textToEditorHtml } from '@client/src/components/RichEmailEditor';
import EmailChipInput from '@client/src/components/EmailChipInput';
import {
  listAttachments as listCompanyAttachments,
  uploadAttachment,
  deleteAttachment,
  getSendOptions,
  saveSendOptions,
  type EmailAttachment,
} from '@client/src/api/sender-profiles';
import * as emailThreadsApi from '@client/src/api/email-threads';
import type {
  Company,
  EmailThread,
  CreateEmailThreadRequest,
} from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@client/src/components/ui/dialog';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@client/src/components/ui/breadcrumb';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@client/src/components/ui/popover';
import { Calendar } from '@client/src/components/ui/calendar';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { useI18n } from '@client/src/i18n';
import { uploadSizeError } from '@client/src/utils/upload-guard';
import { errMessage } from '@client/src/utils/err-message';
import {
  bestChatPhone,
  buildViberUrl,
  buildWhatsAppUrl,
  copyToClipboard,
  isWeComWebview,
  openExternal,
  toDigits,
  type ChatChannel,
} from '@client/src/utils/chat-links';

type DisplayLang = 'en' | 'local';

function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const ComposeEmailPage: React.FC = () => {
  const { companyId = '' } = useParams<{ companyId: string }>();
  const qc = useQueryClient();
  const { t } = useI18n();

  // --- State for editable fields ---
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [subjectLocal, setSubjectLocal] = useState('');
  const [bodyLocal, setBodyLocal] = useState('');
  const [languageCode, setLanguageCode] = useState('en');
  const [displayLang, setDisplayLang] = useState<DisplayLang>('en');

  // --- Thread form state ---
  const [threadDate, setThreadDate] = useState<Date>(new Date());
  const [threadDirection, setThreadDirection] = useState<
    'outbound' | 'inbound' | 'note'
  >('outbound');
  const [threadContent, setThreadContent] = useState('');
  const [threadDialogOpen, setThreadDialogOpen] = useState(false);

  // --- Queries ---
  const { data: company, isLoading: companyLoading } = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => restaurantsApi.getCompany(companyId),
    enabled: !!companyId,
  });

  const { data: composeData, isLoading: composeLoading } = useQuery({
    queryKey: ['compose', companyId],
    queryFn: () => emailGeneratorApi.getComposeData(companyId),
    enabled: !!companyId,
  });

  const { data: threadsData, isLoading: threadsLoading } = useQuery({
    queryKey: ['email-threads', companyId],
    queryFn: () => emailThreadsApi.getEmailThreads(companyId),
    enabled: !!companyId,
  });

  // --- Init state from compose data ---
  useEffect(() => {
    if (composeData) {
      setRecipientEmail(composeData.recipientEmail || '');
      setSubject(composeData.subject || '');
      setBody(composeData.body || '');
      setSubjectLocal(composeData.subjectLocal || '');
      setBodyLocal(composeData.bodyLocal || '');
      setLanguageCode(composeData.languageCode || 'en');
      // Default to local language if available, else english
      if (composeData.subjectLocal || composeData.bodyLocal) {
        setDisplayLang('local');
      } else {
        setDisplayLang('en');
      }
    }
  }, [composeData]);

  // --- Derived values ---
  const hasEmail = !!recipientEmail;
  const hasLocalContent = !!(subjectLocal || bodyLocal);
  // Both IM channels are independently available whenever ANY usable phone exists.
  const chatPhone = company ? bestChatPhone(company) : null;
  const hasChat = !!chatPhone;

  const activeSubject = displayLang === 'local' ? subjectLocal : subject;
  const activeBody = displayLang === 'local' ? bodyLocal : body;

  const sortedThreads = useMemo(() => {
    if (!threadsData?.items) return [];
    return [...threadsData.items].sort(
      (a: EmailThread, b: EmailThread) =>
        new Date(b.threadDate).getTime() - new Date(a.threadDate).getTime(),
    );
  }, [threadsData]);

  // --- Mutations ---
  const saveMutation = useMutation({
    mutationFn: (data: emailGeneratorApi.SaveComposeData) =>
      emailGeneratorApi.saveComposeData(companyId, data),
    onSuccess: () => {
      toast.success(t('保存成功'));
      void qc.invalidateQueries({ queryKey: ['company', companyId] });
    },
    onError: (err: unknown) => {
      logger.error('保存失败', err);
      toast.error(t('保存失败，请稍后重试'));
    },
  });

  const createThreadMutation = useMutation({
    mutationFn: (data: CreateEmailThreadRequest) =>
      emailThreadsApi.createEmailThread(data),
    onSuccess: () => {
      toast.success(t('记录已添加'));
      void qc.invalidateQueries({ queryKey: ['email-threads', companyId] });
      setThreadDialogOpen(false);
      setThreadContent('');
    },
    onError: (err: unknown) => {
      logger.error('添加记录失败', err);
      toast.error(t('添加失败，请稍后重试'));
    },
  });

  const deleteThreadMutation = useMutation({
    mutationFn: (id: string) => emailThreadsApi.deleteEmailThread(id),
    onSuccess: () => {
      toast.success(t('已删除'));
      void qc.invalidateQueries({ queryKey: ['email-threads', companyId] });
    },
    onError: (err: unknown) => {
      logger.error('删除记录失败', err);
      toast.error(t('删除失败，请稍后重试'));
    },
  });

  // --- Handlers ---
  const handleLanguageSwitch = (lang: DisplayLang) => {
    // Save current edits back to their respective state
    if (displayLang === 'en') {
      setSubject(activeSubject);
      setBody(activeBody);
    } else {
      setSubjectLocal(activeSubject);
      setBodyLocal(activeBody);
    }
    setDisplayLang(lang);
  };

  const handleSubjectChange = (value: string) => {
    if (displayLang === 'en') setSubject(value);
    else setSubjectLocal(value);
  };

  const handleBodyChange = (value: string) => {
    if (displayLang === 'en') setBody(value);
    else setBodyLocal(value);
  };

  const handleSave = () => {
    // Sync current visible text to full state
    if (displayLang === 'en') {
      setSubject(activeSubject);
      setBody(activeBody);
    } else {
      setSubjectLocal(activeSubject);
      setBodyLocal(activeBody);
    }
    saveMutation.mutate({
      subject,
      body:
        body && body.trimStart().startsWith('<!--html-->')
          ? body
          : `<!--html-->${textToEditorHtml(body || '')}`,
      subjectLocal,
      bodyLocal,
      language: languageCode,
    });
  };

  const handleCopyAll = async () => {
    const text = `${t('Subject')}: ${activeSubject}\n\n${activeBody}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('主题 + 正文已复制'));
    } catch (err: unknown) {
      logger.error('复制失败', err);
      toast.error(t('复制失败'));
    }
  };

  const handleDownloadEml = () => {
    void emailGeneratorApi.downloadEml(companyId).catch((err: unknown) => {
      logger.error('下载 .eml 失败', err);
      toast.error(t('下载失败，请稍后重试'));
    });
  };

  // SMTP 直发：先把当前可见文本落库（保存失败就别发），再走发送接口
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [attBusy, setAttBusy] = useState(false);
  const { data: attachments, refetch: refetchAttachments } = useQuery({
    queryKey: ['email-attachments', companyId],
    queryFn: () => listCompanyAttachments(companyId),
  });
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  useEffect(() => {
    void getSendOptions(companyId)
      .then((o) => {
        setCc(o.cc || '');
        setBcc(o.bcc || '');
      })
      .catch(() => undefined);
  }, [companyId]);

  const persistSendOptions = (nextCc: string, nextBcc: string): void => {
    void saveSendOptions(companyId, { cc: nextCc, bcc: nextBcc })
      .then(() => toast.success(t('CC/BCC 已保存——发送时自动带上')))
      .catch((err: unknown) => toast.error(errMessage(err, t('保存失败'))));
  };
  const handleSend = async () => {
    if (sending) return;
    setSending(true);
    try {
      const nextSubject = displayLang === 'en' ? activeSubject : subject;
      const nextBody = displayLang === 'en' ? activeBody : body;
      const nextSubjectLocal = displayLang === 'local' ? activeSubject : subjectLocal;
      const nextBodyLocal = displayLang === 'local' ? activeBody : bodyLocal;
      // 富文本正文统一加 `<!--html-->` 哨兵（服务端据此按 HTML 发送）
      // 纯文本要先转成段落 HTML——否则 HTML 渲染会把换行折叠成一行
      const withPrefix = (v: string): string => {
        if (!v) return v;
        if (v.trimStart().startsWith('<!--html-->')) return v;
        return `<!--html-->${textToEditorHtml(v)}`;
      };
      await saveMutation.mutateAsync({
        subject: nextSubject,
        body: withPrefix(nextBody),
        subjectLocal: nextSubjectLocal,
        bodyLocal: withPrefix(nextBodyLocal),
        language: languageCode,
      });
      const result = await emailGeneratorApi.sendEmail(companyId);
      toast.success(t('邮件已发送至 {email}', { email: result.to }));
      setSendConfirmOpen(false);
    } catch (err: unknown) {
      logger.error('直接发送失败', err);
      toast.error(errMessage(err, t('发送失败')));
    } finally {
      setSending(false);
    }
  };

  const handleOpenWxMail = () => {
    if (!hasEmail) return;
    const search = new URLSearchParams();
    if (activeSubject) search.set('subject', activeSubject);
    if (activeBody) search.set('body', activeBody);

    // wxmail:// only resolves inside the WeCom (企业微信) in-app browser;
    // anywhere else navigating to it silently does nothing.
    if (!isWeComWebview()) {
      toast.info(t('当前不在企业微信内置浏览器中，已改用系统邮件客户端'));
      window.location.assign(
        `mailto:${encodeURIComponent(recipientEmail)}?${search.toString()}`,
      );
      return;
    }

    const wxUrl = `wxmail://compose?to=${encodeURIComponent(recipientEmail)}&subject=${encodeURIComponent(activeSubject)}&body=${encodeURIComponent(activeBody)}`;
    window.location.assign(wxUrl);
  };

  /**
   * Open WhatsApp OR Viber. Uses the dedicated casual chat script
   * (company.whatsappMessage*) — never the email body. Both channels are
   * independent; WhatsApp prefills via wa.me, Viber opens viber.me (matching
   * the novascan-web contact page) and the script is copied for pasting.
   *
   * IMPORTANT: window.open / openExternal must happen in the synchronous
   * click stack (before any await) to avoid popup blockers.
   */
  const handleOpenChat = (channel: ChatChannel) => {
    if (!company || !chatPhone) {
      toast.error(t('无可用手机号'));
      return;
    }
    const digits = toDigits(chatPhone);
    const message =
      displayLang === 'local'
        ? company.whatsappMessageLocal || company.whatsappMessage || ''
        : company.whatsappMessage || company.whatsappMessageLocal || '';
    const channelName = channel === 'whatsapp' ? 'WhatsApp' : 'Viber';

    // Open the window FIRST — inside the synchronous click handler — so
    // popup blockers do not suppress it. Then copy the script afterward.
    const url =
      channel === 'whatsapp'
        ? buildWhatsAppUrl(digits, message)
        : buildViberUrl(digits);
    openExternal(url);

    if (message) {
      void copyToClipboard(message).then((ok: boolean) => {
        if (ok) {
          toast.success(
            t('话术已复制，正在外部浏览器打开 {channel}', { channel: channelName }),
          );
        } else {
          toast.error(t('复制失败'));
        }
      });
    } else {
      toast.info(t('正在外部浏览器打开 {channel}', { channel: channelName }));
    }
  };

  const handleAddThread = () => {
    if (!company) return;
    if (!threadContent.trim()) {
      toast.error(t('请输入内容'));
      return;
    }
    createThreadMutation.mutate({
      companyId,
      projectId: company.projectId || '',
      threadDate: threadDate.toISOString().split('T')[0],
      content: threadContent.trim(),
      direction: threadDirection,
    });
  };

  const handleDeleteThread = async (id: string) => {
    if (await showConfirm(t('确认删除该条记录？'))) {
      deleteThreadMutation.mutate(id);
    }
  };

  // --- Direction label helper ---
  const directionLabel = (dir: string): string => {
    switch (dir) {
      case 'outbound':
        return t('发出');
      case 'inbound':
        return t('收到');
      case 'note':
        return t('备注');
      default:
        return dir;
    }
  };

  const directionVariant = (dir: string): 'default' | 'secondary' | 'outline' => {
    switch (dir) {
      case 'outbound':
        return 'default';
      case 'inbound':
        return 'secondary';
      case 'note':
        return 'outline';
      default:
        return 'outline';
    }
  };

  const isLoading = companyLoading || composeLoading;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/" className="flex items-center gap-1">
                <Home size={14} />
                {t('首页')}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>
            <ChevronRight size={14} />
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link
                to={company?.projectId ? `/projects/${company.projectId}` : '/'}
                className="flex items-center gap-1"
              >
                <Building2 size={14} />
                {t('项目')}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>
            <ChevronRight size={14} />
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <span className="text-sm text-slate-500">
              {company?.name || t('公司')}
            </span>
          </BreadcrumbItem>
          <BreadcrumbSeparator>
            <ChevronRight size={14} />
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <span className="text-sm font-medium text-slate-800">{t('撰写邮件')}</span>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="ml-2 text-sm text-slate-500">{t('加载中...')}</span>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          {/* Left: Compose area */}
          <div className="space-y-5">
            <Card data-ai-section-type="card-stat">
              <CardHeader className="p-5">
                <CardTitle className="text-lg font-semibold">
                  {company?.name || t('撰写邮件')}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-0 space-y-4">
                {/* Recipient */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">{t('收件人')}</label>
                  {hasEmail ? (
                    <Input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="recipient@example.com"
                    />
                  ) : (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm text-amber-800">
                        {t('该公司暂无邮箱，推荐使用 WhatsApp / Viber 联系')}
                      </p>
                    </div>
                  )}
                </div>

                {/* Language toggle + Subject */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">{t('主题')}</label>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant={displayLang === 'en' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleLanguageSwitch('en')}
                        className="text-xs"
                      >
                        English
                      </Button>
                      <Button
                        type="button"
                        variant={displayLang === 'local' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleLanguageSwitch('local')}
                        className="text-xs"
                        disabled={!hasLocalContent}
                        title={hasLocalContent ? '' : t('无本地语言版本')}
                      >
                        {t('本地语言')}
                      </Button>
                    </div>
                  </div>
                  <Input
                    type="text"
                    value={activeSubject}
                    onChange={(e) => handleSubjectChange(e.target.value)}
                    placeholder={t('邮件主题')}
                  />
                </div>

                {/* CC/BCC：输入一个邮箱回车即成标签（每公司保存） */}
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <EmailChipInput
                    label="CC"
                    value={cc}
                    onChange={(v) => {
                      setCc(v);
                      persistSendOptions(v, bcc);
                    }}
                    placeholder={t('抄送地址，回车确认')}
                  />
                  <EmailChipInput
                    label="BCC"
                    value={bcc}
                    onChange={(v) => {
                      setBcc(v);
                      persistSendOptions(cc, v);
                    }}
                    placeholder={t('密送地址，回车确认')}
                  />
                </div>

                {/* Body */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">{t('正文')}</label>
                  <RichEmailEditor
                    value={activeBody}
                    onChange={(html) => handleBodyChange(html)}
                    placeholder={t('邮件正文...')}
                    minHeight={400}
                  />
                </div>

                {/* 附件：随本封邮件发出（发送时自动附上） */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">{t('附件')}</label>
                    <label className="cursor-pointer rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const sizeErr = uploadSizeError(f);
                          if (sizeErr) {
                            toast.error(sizeErr);
                            e.target.value = '';
                            return;
                          }
                          setAttBusy(true);
                          uploadAttachment(companyId, f)
                            .then(() => {
                              toast.success(t('附件已上传'));
                              return refetchAttachments();
                            })
                            .catch((err: unknown) =>
                              toast.error(t('上传失败') + ': ' + (err instanceof Error ? err.message : '')),
                            )
                            .finally(() => {
                              setAttBusy(false);
                              e.target.value = '';
                            });
                        }}
                      />
                      {t('上传附件')}
                    </label>
                  </div>
                  {(attachments?.length ?? 0) > 0 ? (
                    <div className="space-y-1">
                      {attachments!.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between rounded border border-slate-200 px-2 py-1 text-xs"
                        >
                          <span className="truncate text-slate-700">
                            {a.filename} <span className="text-slate-400">({(a.size / 1024).toFixed(0)} KB)</span>
                          </span>
                          <button
                            type="button"
                            className="text-red-500 hover:text-red-600"
                            onClick={() => {
                              deleteAttachment(a.id)
                                .then(() => refetchAttachments())
                                .catch(() => toast.error(t('删除失败')));
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">{t('暂无附件——上传的文件会随这封邮件一起发出。')}</p>
                  )}
                  {attBusy && <Loader2 className="animate-spin text-slate-400" size={14} />}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 pt-2 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    onClick={handleCopyAll}
                  >
                    <Copy size={16} />
                    {t('复制主题 + 正文')}
                  </Button>
                  {hasEmail && (
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      onClick={handleDownloadEml}
                    >
                      <Download size={16} />
                      {t('下载 .eml')}
                    </Button>
                  )}
                  {hasEmail && (
                    <Button
                      type="button"
                      variant="default"
                      size="default"
                      onClick={() => setSendConfirmOpen(true)}
                      disabled={sending}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Send size={16} />
                      {t('发送邮件（SMTP）')}
                    </Button>
                  )}
                  {hasEmail && (
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      onClick={handleOpenWxMail}
                    >
                      <Mail size={16} />
                      {t('在企业微信中打开')}
                    </Button>
                  )}
                  {/* WhatsApp and Viber are BOTH independently available whenever a phone exists */}
                  {hasChat && (
                    <>
                      <Button
                        type="button"
                        variant="default"
                        size="default"
                        onClick={() => void handleOpenChat('whatsapp')}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <MessageCircle size={16} />
                        {t('WhatsApp 联系')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="default"
                        onClick={() => void handleOpenChat('viber')}
                        className="text-purple-600 border-purple-200 hover:bg-purple-50 hover:text-purple-700"
                      >
                        <Phone size={16} />
                        {t('Viber 联系')}
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="default"
                    size="default"
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save size={16} />
                    )}
                    {t('保存')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Email threads */}
          <Card data-ai-section-type="card-list" className="lg:sticky lg:top-6 lg:self-start">
            <CardHeader className="p-5 flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-semibold">{t('往来记录')}</CardTitle>
              <Dialog open={threadDialogOpen} onOpenChange={setThreadDialogOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="default" size="sm">
                    <Plus size={14} />
                    {t('添加记录')}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('添加往来记录')}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">{t('日期')}</label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                          >
                            {formatDate(threadDate)}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={threadDate}
                            onSelect={(date: Date | undefined) => {
                              if (date) setThreadDate(date);
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">{t('方向')}</label>
                      <Select
                        value={threadDirection}
                        onValueChange={(val: string) =>
                          setThreadDirection(val as 'outbound' | 'inbound' | 'note')
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="outbound">{t('发出')}</SelectItem>
                          <SelectItem value="inbound">{t('收到')}</SelectItem>
                          <SelectItem value="note">{t('备注')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">{t('内容')}</label>
                      <Textarea
                        value={threadContent}
                        onChange={(e) => setThreadContent(e.target.value)}
                        placeholder={t('记录内容...')}
                        className="min-h-[120px]"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button type="button" variant="outline">
                        {t('取消')}
                      </Button>
                    </DialogClose>
                    <Button
                      type="button"
                      variant="default"
                      onClick={handleAddThread}
                      disabled={createThreadMutation.isPending}
                    >
                      {createThreadMutation.isPending && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {t('保存')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              {threadsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : sortedThreads.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-slate-400">{t('暂无往来记录')}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {t('点击「添加记录」开始追踪沟通')}
                  </p>
                </div>
              ) : (
                <ul className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {sortedThreads.map((thread: EmailThread) => (
                    <li
                      key={thread.id}
                      className="group relative rounded-lg border border-slate-200 bg-slate-50/50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={directionVariant(thread.direction)}
                            className="text-xs"
                          >
                            {directionLabel(thread.direction)}
                          </Badge>
                          <span className="text-xs text-slate-400">
                            {formatDate(thread.threadDate)}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => handleDeleteThread(thread.id)}
                          disabled={deleteThreadMutation.isPending}
                          title={t('删除')}
                        >
                          <Trash2 size={14} className="text-slate-400" />
                        </Button>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 break-words">
                        {thread.content}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* SMTP 直发确认：真实外发，必须显式确认 */}
      <Dialog open={sendConfirmOpen} onOpenChange={(v) => !sending && setSendConfirmOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('确认发送邮件')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            {t('将通过系统 SMTP 把这封邮件发送给 {email}，发送前会先保存当前编辑内容，确认发送？', {
              email: recipientEmail || '',
            })}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setSendConfirmOpen(false)} disabled={sending}>
              {t('取消')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSend()}
              disabled={sending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {sending && <Loader2 className="animate-spin" size={14} />}
              {t('确认发送')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ComposeEmailPage;
