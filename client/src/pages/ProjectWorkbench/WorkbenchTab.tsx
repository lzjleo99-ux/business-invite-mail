import React, { useMemo, useState } from 'react';
import { Table, TableProps } from '@lark-apaas/client-toolkit/antd-table';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  Search,
  Play,
  Mail,
  Trash2,
  RefreshCw,
  Globe,
  AlertTriangle,
  Loader2,
  Edit3,
  X,
  MessageCircle,
  MapPin,
  MoreHorizontal,
  Copy,
  Download,
  Star,
  StarOff,
  Phone,
  Send,
} from 'lucide-react';

import * as websiteAnalyzerApi from '@client/src/api/website-analyzer';
import * as emailGeneratorApi from '@client/src/api/email-generator';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import { Badge } from '@client/src/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@client/src/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/src/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@client/src/components/ui/tooltip';
import SendEmailDropdown from './SendEmailDropdown';
import type {
  Company,
  CompanyStatus,
  CompanyStatsResponse,
  CompanyListResponse,
  StatsFilterKey,
} from '@shared/api.interface';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import { useI18n } from '@client/src/i18n';
import {
  bestChatPhone,
  bestWhatsAppPhone,
  bestViberPhone,
  buildWhatsAppUrl,
  buildViberUrl,
  toDigits,
  copyToClipboard as copyTextUtil,
  isWeComWebview,
  openExternal,
  isLikelyLandline,
  type ChatChannel,
} from '@client/src/utils/chat-links';
import { useBatchOperation, type BatchItemStatus } from '@client/src/hooks/useBatchOperation';

type StatusFilterValue = CompanyStatus | 'all';

const getStatusBadgeStyle = (status: CompanyStatus): string => {
  switch (status) {
    case 'pending':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    case 'analyzing':
    case 'analyzed':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'generating':
      return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'generated':
      return 'bg-green-50 text-green-700 border-green-200';
    case 'no_email':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'failed':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return '';
  }
};

export interface WorkbenchTabProps {
  stats: CompanyStatsResponse | undefined;
  listData: CompanyListResponse | undefined;
  listLoading: boolean;
  page: number;
  pageSize: number;
  statusFilter: StatusFilterValue;
  noEmailFilter: boolean;
  filterKey: StatsFilterKey;
  searchInput: string;
  analyzingId: string | null;
  generatingId: string | null;
  generatingWhatsAppId: string | null;
  editingEmail: { subject: string; body: string; subjectLocal: string; bodyLocal: string } | null;
  editingEmailLanguage: 'local' | 'en';
  savingEmailId: string | null;
  setPage: (p: number) => void;
  setStatusFilter: (v: StatusFilterValue) => void;
  setSearchInput: (v: string) => void;
  setEditingEmail: (v: { subject: string; body: string; subjectLocal: string; bodyLocal: string } | null) => void;
  setEditingEmailLanguage: (v: 'local' | 'en') => void;
  onSearch: () => void;
  onImportClick: () => void;
  onImportDrop: (e: React.DragEvent<HTMLButtonElement>) => void;
  onAnalyze: (record: Company) => void;
  onGenerate: (record: Company) => void;
  onDelete: (record: Company) => void;
  onSaveEmail: (record: Company) => void;
  onRegenerateEmail: (record: Company) => void;
  projectId: string;
  onGenerateWhatsApp: (record: Company) => void;
  onStatClick: (statKey: StatsFilterKey) => void;
  onToggleStar: (record: Company) => void;
  onUpdateContactStatus: (
    record: Company,
    type: 'whatsapp' | 'viber' | 'email',
    contacted: boolean,
  ) => void;
}

const WorkbenchTab: React.FC<WorkbenchTabProps> = ({
  stats,
  listData,
  listLoading,
  page,
  pageSize,
  statusFilter,
  noEmailFilter,
  filterKey,
  searchInput,
  projectId,
  analyzingId,
  generatingId,
  generatingWhatsAppId,
  editingEmail,
  editingEmailLanguage,
  savingEmailId,
  setPage,
  setStatusFilter,
  setSearchInput,
  setEditingEmail,
  setEditingEmailLanguage,
  onSearch,
  onImportClick,
  onImportDrop,
  onAnalyze,
  onGenerate,
  onDelete,
  onSaveEmail,
  onRegenerateEmail,
  onGenerateWhatsApp,
  onStatClick,
  onToggleStar,
  onUpdateContactStatus,
}) => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const qc = useQueryClient();

  const items = listData?.items || [];

  // --- Batch analyze operation ---
  const batchAnalyzeOp = useBatchOperation<Company>({
    items,
    getItemId: (item: Company) => item.id,
    operation: async (item: Company) => {
      await websiteAnalyzerApi.analyzeCompany(item.id);
      void qc.invalidateQueries({ queryKey: ['companies'] });
      void qc.invalidateQueries({ queryKey: ['company-stats'] });
    },
    concurrency: 2,
    stageLabel: t('分析中...'),
    onComplete: ({ success, failed }: { success: number; failed: number }) => {
      void qc.invalidateQueries({ queryKey: ['companies'] });
      void qc.invalidateQueries({ queryKey: ['company-stats'] });
      if (failed > 0) {
        toast.warning(
          t('批量分析完成：成功 {s} 条，失败 {f} 条', { s: success, f: failed }),
        );
      } else {
        toast.success(t('批量分析完成：共 {s} 条全部成功', { s: success }));
      }
    },
  });

  // --- Batch generate email operation ---
  const batchGenerateOp = useBatchOperation<Company>({
    items,
    getItemId: (item: Company) => item.id,
    operation: async (item: Company) => {
      const result = await emailGeneratorApi.generateEmail(item.id);
      void qc.setQueryData(
        ['companies', projectId],
        (old: { items: Company[] } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((c: Company) =>
              c.id === item.id
                ? {
                    ...c,
                    status: 'generated' as CompanyStatus,
                    emailSubject: result.subject,
                    emailBody: result.body,
                    emailSubjectLocal: result.subjectLocal,
                    emailBodyLocal: result.bodyLocal,
                    emailLanguage: result.languageCode,
                    websiteSummary: result.summary,
                  }
                : c,
            ),
          };
        },
      );
    },
    concurrency: 2,
    stageLabel: t('生成中...'),
    onComplete: ({ success, failed }: { success: number; failed: number }) => {
      void qc.invalidateQueries({ queryKey: ['companies'] });
      void qc.invalidateQueries({ queryKey: ['company-stats'] });
      if (failed > 0) {
        toast.warning(
          t('批量生成完成：成功 {s} 条，失败 {f} 条', { s: success, f: failed }),
        );
      } else {
        toast.success(t('批量生成完成：共 {s} 条全部成功', { s: success }));
      }
    },
  });

  // --- Batch WhatsApp operation ---
  const batchWhatsAppOp = useBatchOperation<Company>({
    items,
    getItemId: (item: Company) => item.id,
    operation: async (item: Company) => {
      const result = await emailGeneratorApi.generateWhatsApp(item.id);
      void qc.setQueryData(
        ['companies', projectId],
        (old: { items: Company[] } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((c: Company) =>
              c.id === item.id
                ? {
                    ...c,
                    whatsappPhone: result.internationalPhone,
                    whatsappMessage: result.messageText,
                    whatsappMessageLocal: result.messageTextLocal,
                  }
                : c,
            ),
          };
        },
      );
    },
    concurrency: 2,
    stageLabel: t('准备IM话术中...'),
    onComplete: ({ success, failed }: { success: number; failed: number }) => {
      void qc.invalidateQueries({ queryKey: ['companies'] });
      if (failed > 0) {
        toast.warning(
          t('批量准备 IM 话术完成：成功 {s} 条，失败 {f} 条', { s: success, f: failed }),
        );
      } else {
        toast.success(t('批量准备 IM 话术完成：共 {s} 条全部成功', { s: success }));
      }
    },
  });

  const STATUS_OPTIONS: { value: StatusFilterValue; label: string }[] = [
    { value: 'all', label: t('全部') },
    { value: 'pending', label: t('待分析') },
    { value: 'analyzing', label: t('分析中') },
    { value: 'analyzed', label: t('已分析') },
    { value: 'generating', label: t('生成中') },
    { value: 'generated', label: t('已生成') },
    { value: 'no_email', label: t('缺邮箱') },
    { value: 'failed', label: t('失败') },
  ];

  const statusLabel = (status: CompanyStatus): string =>
    ({
      pending: t('待分析'),
      analyzing: t('分析中'),
      analyzed: t('已分析'),
      generating: t('生成中'),
      generated: t('已生成'),
      no_email: t('缺邮箱'),
      failed: t('失败'),
    })[status] || status;

  const statCards = useMemo(() => {
    const data = stats || {
      total: 0,
      analyzed: 0,
      generated: 0,
      noEmail: 0,
      failed: 0,
      starred: 0,
      pending: 0,
      hasPhone: 0,
      hasWhatsapp: 0,
    };
    return [
      { key: 'all' as const, label: t('总数量'), value: data.total, color: 'text-slate-800' },
      { key: 'starred' as const, label: t('星标企业'), value: data.starred, color: 'text-amber-500' },
      { key: 'analyzed' as const, label: t('已分析'), value: data.analyzed, color: 'text-blue-600' },
      { key: 'pending' as const, label: t('待分析'), value: data.pending, color: 'text-slate-600' },
      { key: 'generated' as const, label: t('已生成邮件'), value: data.generated, color: 'text-green-600' },
      { key: 'no_email' as const, label: t('缺邮箱'), value: data.noEmail, color: 'text-amber-600' },
      { key: 'failed' as const, label: t('失败'), value: data.failed, color: 'text-red-600' },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, t]);

  const activeFilterLabel = useMemo(() => {
    if (filterKey === 'all') return '';
    const map: Record<Exclude<StatsFilterKey, 'all'>, string> = {
      starred: t('星标企业'),
      analyzed: t('已分析'),
      pending: t('待分析'),
      generated: t('已生成邮件'),
      no_email: t('缺邮箱'),
      failed: t('失败'),
    };
    return map[filterKey] || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, t]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('{label}已复制', { label }));
    } catch (err: unknown) {
      logger.error('复制失败', err);
      toast.error(t('复制失败'));
    }
  };

  const getMapUrl = (record: Company): string | null => {
    if (record.latitude !== null && record.longitude !== null) {
      return `https://www.google.com/maps/search/?api=1&query=${record.latitude},${record.longitude}`;
    }
    if (record.address) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(record.address)}`;
    }
    if (record.source) {
      return record.source;
    }
    return null;
  };

  /**
   * Open WhatsApp OR Viber for a company. Both channels are independently
   * available whenever ANY usable phone exists. The same casual bilingual
   * chat script is used for both: WhatsApp prefills via wa.me, Viber opens
   * the viber.me chat (reference: novascan-web contact page) and the script
   * is copied to the clipboard so it can be pasted.
   *
   * IMPORTANT: window.open / openExternal must happen in the synchronous
   * click stack (before any await) to avoid popup blockers.
   */
  const openChat = (
    channel: ChatChannel,
    record: Company,
    lang: 'local' | 'en',
  ) => {
    const phone = channel === 'whatsapp'
      ? bestWhatsAppPhone(record) || bestChatPhone(record)
      : bestViberPhone(record) || bestChatPhone(record);
    if (!phone) {
      toast.error(t('该公司没有可用电话号码'));
      return;
    }
    const digits = toDigits(phone);
    const message =
      (lang === 'local'
        ? record.whatsappMessageLocal || record.whatsappMessage
        : record.whatsappMessage) ||
      record.whatsappMessage ||
      '';
    const channelName = channel === 'whatsapp' ? 'WhatsApp' : 'Viber';

    // Open the window FIRST — inside the synchronous click handler — so
    // popup blockers do not suppress it. Then copy the script afterward.
    const url =
      channel === 'whatsapp'
        ? buildWhatsAppUrl(digits, message)
        : buildViberUrl(digits);
    openExternal(url);

    if (message) {
      void copyTextUtil(message).then((ok: boolean) => {
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

  // Per-row display language state for email detail
  const [emailDisplayLang, setEmailDisplayLang] = useState<Record<string, 'local' | 'en'>>({});
  const [whatsAppLang, setWhatsAppLang] = useState<Record<string, 'local' | 'en'>>({});

  const getEmailDisplayLang = (record: Company): 'local' | 'en' => {
    if (emailDisplayLang[record.id]) return emailDisplayLang[record.id];
    return record.emailSubjectLocal ? 'local' : 'en';
  };

  const getEmailSubject = (record: Company, lang: 'local' | 'en'): string => {
    if (lang === 'local' && record.emailSubjectLocal) return record.emailSubjectLocal;
    return record.emailSubject || '';
  };

  const getEmailBody = (record: Company, lang: 'local' | 'en'): string => {
    if (lang === 'local' && record.emailBodyLocal) return record.emailBodyLocal;
    return record.emailBody || '';
  };

  const getWhatsAppLang = (record: Company): 'local' | 'en' => {
    const stored = whatsAppLang[record.id];
    if (stored === 'en') return 'en';
    if (record.whatsappMessageLocal) return 'local';
    return 'en';
  };

  const getWhatsAppMessage = (record: Company, lang: 'local' | 'en'): string => {
    if (lang === 'local' && record.whatsappMessageLocal) return record.whatsappMessageLocal;
    return record.whatsappMessage || '';
  };

  const startEditEmail = (record: Company) => {
    setEditingEmail({
      subject: record.emailSubject || '',
      body: record.emailBody || '',
      subjectLocal: record.emailSubjectLocal || '',
      bodyLocal: record.emailBodyLocal || '',
    });
  };

  const columns: TableProps<Company>['columns'] = [
    {
      title: '',
      key: 'star',
      width: 44,
      fixed: 'left',
      render: (_val: unknown, record: Company) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar(record);
          }}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-amber-50 text-amber-500 hover:text-amber-600"
          title={record.isStarred ? t('取消星标') : t('加星标')}
          aria-label={record.isStarred ? t('取消星标') : t('加星标')}
        >
          {record.isStarred ? <Star size={16} fill="currentColor" /> : <StarOff size={16} />}
        </button>
      ),
    },
    {
      title: t('序号'),
      dataIndex: 'seqNo',
      width: 70,
      key: 'seqNo',
      render: (_val: unknown, _record: Company, index: number) => {
        const startIdx = (page - 1) * pageSize;
        return startIdx + index + 1;
      },
    },
    {
      title: t('名称'),
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      width: 220,
      ellipsis: true,
    },
    {
      title: t('国家/地区'),
      dataIndex: 'country',
      key: 'country',
      width: 100,
      ellipsis: true,
    },
    {
      title: t('业务类型'),
      dataIndex: 'websiteBusinessType',
      key: 'websiteBusinessType',
      width: 140,
      ellipsis: true,
      render: (val: string | null) =>
        val || <span className="text-slate-400">-</span>,
    },
    {
      title: t('邮箱'),
      dataIndex: 'email',
      key: 'email',
      width: 200,
      ellipsis: true,
      render: (val: string | null) =>
        val ? (
          <span className="text-slate-700">{val}</span>
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      key: 'status',
      width: 160,
      render: (_val: unknown, record: Company) => {
        const analyzeStatus = batchAnalyzeOp.perItemStatus[record.id];
        const generateStatus = batchGenerateOp.perItemStatus[record.id];
        const whatsappStatus = batchWhatsAppOp.perItemStatus[record.id];

        let batchStatus: BatchItemStatus | undefined;
        let batchLabel = '';
        if (analyzeStatus && analyzeStatus !== 'pending') {
          batchStatus = analyzeStatus;
          batchLabel = t('分析中...');
        } else if (generateStatus && generateStatus !== 'pending') {
          batchStatus = generateStatus;
          batchLabel = t('生成中...');
        } else if (whatsappStatus && whatsappStatus !== 'pending') {
          batchStatus = whatsappStatus;
          batchLabel = t('准备IM话术中...');
        }

        if (batchStatus === 'processing') {
          return (
            <div className="flex items-center gap-1.5 text-primary">
              <Loader2 className="animate-spin" size={14} />
              <span className="text-xs font-medium">{batchLabel}</span>
            </div>
          );
        }
        if (batchStatus === 'failed') {
          return (
            <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-200">
              {t('失败')}
            </Badge>
          );
        }
        if (batchStatus === 'success') {
          return (
            <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200">
              {t('成功')}
            </Badge>
          );
        }
        return (
          <Badge variant="secondary" className={getStatusBadgeStyle(record.status)}>
            {statusLabel(record.status)}
          </Badge>
        );
      },
    },
    {
      title: t('操作'),
      key: 'action',
      fixed: 'right',
      width: 560,
      render: (_val: unknown, record: Company) => {
        const effectiveEmail = record.websiteContactEmail || record.email || '';
        const effectivePhone = record.websiteContactPhone || record.phone || '';
        const hasEmail = !!effectiveEmail;
        const chatPhone = bestChatPhone(record);
        const waPhone = bestWhatsAppPhone(record);
        const viberPhone = bestViberPhone(record);
        const hasWhatsApp = !!waPhone;
        const hasViber = !!viberPhone;
        const hasChat = hasWhatsApp || hasViber;
        const hasPhone = !!effectivePhone;
        const canCompose = hasEmail || hasPhone;
        const landline = isLikelyLandline(record);
        const hasGeneratedEmail = record.status === 'generated';
        const mapUrl = getMapUrl(record);
        const hasMap = mapUrl !== null;
        const waLang: 'local' | 'en' = record.whatsappMessageLocal ? 'local' : 'en';

        const waMessage =
          (waLang === 'local'
            ? record.whatsappMessageLocal || record.whatsappMessage
            : record.whatsappMessage) || record.whatsappMessage || '';
        const waUrl = hasWhatsApp
          ? buildWhatsAppUrl(toDigits(waPhone || waPhone), waMessage)
          : '';
        const viberUrl = hasViber ? buildViberUrl(toDigits(viberPhone)) : '';

        const handleMapClick = () => {
          if (!mapUrl) return;
          openExternal(mapUrl);
        };

        const waTooltip = !hasWhatsApp
          ? t('无可用 WhatsApp 号码')
          : t('打开 WhatsApp');
        const viberTooltip = !hasViber
          ? t('无可用 Viber 号码')
          : landline
            ? t('该号码为座机号，Viber 仍可使用')
            : t('打开 Viber');

        return (
          <div className="flex gap-2 flex-wrap items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => navigate(`/compose/${record.id}`)}
                    disabled={!canCompose}
                  >
                    <Mail size={14} />
                    {t('发邮件')}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {canCompose ? t('撰写邮件') : t('无邮箱和手机号')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                {hasWhatsApp ? (
                  <UniversalLink
                    to={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (isWeComWebview()) {
                        e.preventDefault();
                        openExternal(waUrl);
                      }
                      if (waMessage) void copyTextUtil(waMessage);
                    }}
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border transition-colors text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
                  >
                    <MessageCircle size={14} />
                    WhatsApp
                  </UniversalLink>
                ) : (
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled
                      className="text-green-600 border-green-200 opacity-50"
                    >
                      <MessageCircle size={14} />
                      WhatsApp
                    </Button>
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">{waTooltip}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                {hasViber ? (
                  <UniversalLink
                    to={viberUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (isWeComWebview()) {
                        e.preventDefault();
                        openExternal(viberUrl);
                      }
                      if (waMessage) void copyTextUtil(waMessage);
                    }}
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border transition-colors text-purple-600 border-purple-200 hover:bg-purple-50 hover:text-purple-700"
                  >
                    <Phone size={14} />
                    Viber
                  </UniversalLink>
                ) : (
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled
                      className="text-purple-600 border-purple-200 opacity-50"
                    >
                      <Phone size={14} />
                      Viber
                    </Button>
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">{viberTooltip}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleMapClick}
                    disabled={!hasMap}
                  >
                    <MapPin size={14} />
                    {t('地图')}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {hasMap ? t('打开地图') : t('无位置信息')}
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreHorizontal size={14} />
                  {t('更多')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() => {
                    if (hasEmail) void copyToClipboard(effectiveEmail, t('邮箱'));
                  }}
                  className={hasEmail ? 'gap-2' : 'gap-2 opacity-50 cursor-not-allowed pointer-events-none'}
                >
                  <Copy size={14} />
                  {t('复制邮箱')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (hasPhone) void copyToClipboard(effectivePhone, t('电话'));
                  }}
                  className={hasPhone ? 'gap-2' : 'gap-2 opacity-50 cursor-not-allowed pointer-events-none'}
                >
                  <Copy size={14} />
                  {t('复制电话')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (chatPhone) void copyToClipboard(chatPhone, t('复制 WhatsApp 号码'));
                  }}
                  className={hasChat ? 'gap-2' : 'gap-2 opacity-50 cursor-not-allowed pointer-events-none'}
                >
                  <Copy size={14} />
                  {t('复制 WhatsApp 号码')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    if (hasGeneratedEmail) {
                      const url = emailGeneratorApi.getEmlUrl(record.id);
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className={hasGeneratedEmail ? 'gap-2' : 'gap-2 opacity-50 cursor-not-allowed pointer-events-none'}
                >
                  <Download size={14} />
                  {t('下载 .eml')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (record.website) {
                      window.open(record.website, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className={record.website ? 'gap-2' : 'gap-2 opacity-50 cursor-not-allowed pointer-events-none'}
                >
                  <Globe size={14} />
                  {t('打开官网')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-500 hover:text-red-600 hover:bg-red-50"
              onClick={() => onDelete(record)}
            >
              <Trash2 size={14} />
              {t('删除')}
            </Button>
          </div>
        );
      },
    },
  ];

  const expandedRowRender = (record: Company) => {
    const isEditing = editingEmail !== null;
    const hasLocalEmail = !!(record.emailSubjectLocal || record.emailBodyLocal);
    const displayLang = getEmailDisplayLang(record);
    const chatPhone = bestChatPhone(record);
    const waPhone = bestWhatsAppPhone(record);
    const viberPhone = bestViberPhone(record);
    const hasWhatsApp = !!waPhone;
    const hasViber = !!viberPhone;
    const hasChat = hasWhatsApp || hasViber;
    const landline = isLikelyLandline(record);
    const hasWhatsAppMessage = !!record.whatsappMessage;
    const hasWhatsAppLocal = !!record.whatsappMessageLocal;
    const waLang: 'local' | 'en' = getWhatsAppLang(record);
    const waDetailMessage = getWhatsAppMessage(record, waLang);

    const viewSubject = getEmailSubject(record, displayLang);
    const viewBody = getEmailBody(record, displayLang);

    const editSubject =
      editingEmailLanguage === 'local' ? editingEmail?.subjectLocal ?? '' : editingEmail?.subject ?? '';
    const editBody =
      editingEmailLanguage === 'local' ? editingEmail?.bodyLocal ?? '' : editingEmail?.body ?? '';

    const emailSubject = isEditing ? editSubject : viewSubject;
    const emailBody = isEditing ? editBody : viewBody;

    const handleLangChange = (lang: 'local' | 'en') => {
      if (lang === 'local' && !hasLocalEmail) return;
      if (isEditing) {
        setEditingEmailLanguage(lang);
      } else {
        setEmailDisplayLang((prev) => ({ ...prev, [record.id]: lang }));
      }
    };

    const activeLang = isEditing ? editingEmailLanguage : displayLang;

    return (
      <div className="py-2">
        {/* Contact Status Bar */}
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-slate-800">{t('联系状态')}</h4>
          <div className="flex gap-2">
            <Button
              variant={record.contactStatus?.whatsappContactedAt ? 'default' : 'outline'}
              size="sm"
              onClick={() =>
                onUpdateContactStatus(
                  record,
                  'whatsapp',
                  !record.contactStatus?.whatsappContactedAt,
                )
              }
              className={
                record.contactStatus?.whatsappContactedAt
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700'
              }
            >
              <MessageCircle size={14} />
              {t('已WhatsApp联系')}
              {record.contactStatus?.whatsappContactedAt && (
                <span className="ml-1 text-xs opacity-80">
                  {new Date(record.contactStatus.whatsappContactedAt).toLocaleDateString()}
                </span>
              )}
            </Button>
            <Button
              variant={record.contactStatus?.viberContactedAt ? 'default' : 'outline'}
              size="sm"
              onClick={() =>
                onUpdateContactStatus(
                  record,
                  'viber',
                  !record.contactStatus?.viberContactedAt,
                )
              }
              className={
                record.contactStatus?.viberContactedAt
                  ? 'bg-purple-600 hover:bg-purple-700 text-white'
                  : 'text-purple-600 border-purple-200 hover:bg-purple-50 hover:text-purple-700'
              }
            >
              <Phone size={14} />
              {t('已Viber联系')}
              {record.contactStatus?.viberContactedAt && (
                <span className="ml-1 text-xs opacity-80">
                  {new Date(record.contactStatus.viberContactedAt).toLocaleDateString()}
                </span>
              )}
            </Button>
            <Button
              variant={record.contactStatus?.emailContactedAt ? 'default' : 'outline'}
              size="sm"
              onClick={() =>
                onUpdateContactStatus(
                  record,
                  'email',
                  !record.contactStatus?.emailContactedAt,
                )
              }
              className={
                record.contactStatus?.emailContactedAt
                  ? 'bg-primary hover:bg-primary/90 text-white'
                  : ''
              }
            >
              <Mail size={14} />
              {t('已邮件联系')}
              {record.contactStatus?.emailContactedAt && (
                <span className="ml-1 text-xs opacity-80">
                  {new Date(record.contactStatus.emailContactedAt).toLocaleDateString()}
                </span>
              )}
            </Button>
          </div>
        </div>
        <Tabs defaultValue="website">
          <TabsList>
            <TabsTrigger value="website">{t('网站分析')}</TabsTrigger>
            <TabsTrigger value="email">{t('邮件内容')}</TabsTrigger>
            <TabsTrigger value="whatsapp">{t('即时消息')}</TabsTrigger>
          </TabsList>
          <TabsContent value="website" className="pt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('网站摘要')}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {record.websiteSummary || t('暂无数据')}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('业务类型')}</p>
                <p className="text-sm text-slate-700">
                  {record.websiteBusinessType || '-'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('产品/服务')}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {record.websiteProducts || '-'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('工作时间')}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {record.websiteHours || '-'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('网站语言')}</p>
                <p className="text-sm text-slate-700">
                  {record.websiteLanguage || '-'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">
                  {t('从网站提取的邮箱')}
                </p>
                <p className="text-sm text-slate-700">
                  {record.websiteContactEmail || '-'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">
                  {t('从网站提取的电话')}
                </p>
                <p className="text-sm text-slate-700">
                  {record.websiteContactPhone || '-'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('社交媒体')}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {record.websiteSocial || '-'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('规模印象')}</p>
                <p className="text-sm text-slate-700">
                  {record.websiteSizeImpression || record.websiteScale || '-'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{t('亮点')}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {record.websiteHighlights || '-'}
                </p>
              </div>
            </div>
            {record.website && (
              <div className="mt-4">
                <UniversalLink
                  to={record.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Globe size={14} />
                  {record.website}
                </UniversalLink>
              </div>
            )}
            {record.analyzeError && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-medium text-red-700 flex items-center gap-1">
                  <AlertTriangle size={14} />
                  {t('错误信息')}
                </p>
                <p className="mt-1 text-sm text-red-600 whitespace-pre-wrap">
                  {record.analyzeError}
                </p>
              </div>
            )}
          </TabsContent>
           <TabsContent value="email" className="pt-4 space-y-4">
             {/* Language Toggle */}
             <div className="flex items-center gap-2">
               <span className="text-xs text-slate-500">{t('语言：')}</span>
               <div className="inline-flex rounded-md overflow-hidden border border-slate-200">
                 <button
                   type="button"
                   onClick={() => handleLangChange('local')}
                   disabled={!hasLocalEmail}
                   className={`px-3 py-1 text-xs font-medium transition-colors ${
                     activeLang === 'local'
                       ? 'bg-primary text-white'
                       : hasLocalEmail
                         ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                         : 'bg-slate-50 text-slate-300 cursor-not-allowed'
                   }`}
                 >
                   {t('本地语言')}
                 </button>
                 <button
                   type="button"
                   onClick={() => handleLangChange('en')}
                   className={`px-3 py-1 text-xs font-medium transition-colors ${
                     activeLang === 'en'
                       ? 'bg-primary text-white'
                       : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                   }`}
                 >
                   English
                 </button>
               </div>
               {!hasLocalEmail && (
                 <span className="text-xs text-slate-400">{t('（暂无本地语言版本）')}</span>
               )}
             </div>

             <div className="space-y-1">
               <p className="text-xs font-medium text-slate-500">{t('邮件主题')}</p>
               {isEditing ? (
                 <Input
                   value={emailSubject}
                   onChange={(e) => {
                     if (!editingEmail) return;
                     if (editingEmailLanguage === 'local') {
                       setEditingEmail({ ...editingEmail, subjectLocal: e.target.value });
                     } else {
                       setEditingEmail({ ...editingEmail, subject: e.target.value });
                     }
                   }}
                   placeholder={t('请输入邮件主题')}
                 />
               ) : (
                 <p className="text-sm text-slate-700 font-medium">
                   {emailSubject || t('暂无邮件内容')}
                 </p>
               )}
             </div>
             <div className="space-y-1">
               <p className="text-xs font-medium text-slate-500">{t('邮件正文')}</p>
               {isEditing ? (
                 <Textarea
                   value={emailBody}
                   onChange={(e) => {
                     if (!editingEmail) return;
                     if (editingEmailLanguage === 'local') {
                       setEditingEmail({ ...editingEmail, bodyLocal: e.target.value });
                     } else {
                       setEditingEmail({ ...editingEmail, body: e.target.value });
                     }
                   }}
                   placeholder={t('请输入邮件正文')}
                   rows={12}
                 />
               ) : (
                 <div className="rounded-md border border-slate-200 bg-slate-50 p-3 min-h-[200px]">
                   <p className="text-sm text-slate-700 whitespace-pre-wrap">
                     {emailBody || t('暂无邮件内容')}
                   </p>
                 </div>
               )}
             </div>
             <div className="flex gap-2 justify-end">
               {isEditing ? (
                 <>
                   <Button
                     variant="outline"
                     size="sm"
                     onClick={() => setEditingEmail(null)}
                   >
                     {t('取消')}
                   </Button>
                   <Button
                     variant="default"
                     size="sm"
                     onClick={() => onSaveEmail(record)}
                     disabled={savingEmailId === record.id}
                   >
                     {savingEmailId === record.id && (
                       <Loader2 className="animate-spin" size={14} />
                     )}
                     {t('保存修改')}
                   </Button>
                 </>
               ) : (
                 <>
                   <Button
                     variant="outline"
                     size="sm"
                     onClick={() => startEditEmail(record)}
                     disabled={!record.emailSubject && !record.emailBody}
                   >
                     <Edit3 size={14} />
                     {t('编辑邮件')}
                   </Button>
                   <Button
                     variant="secondary"
                     size="sm"
                     onClick={() => onRegenerateEmail(record)}
                     disabled={generatingId === record.id}
                   >
                     {generatingId === record.id ? (
                       <Loader2 className="animate-spin" size={14} />
                     ) : (
                       <RefreshCw size={14} />
                     )}
                     {t('重新生成')}
                   </Button>
                   <SendEmailDropdown
                     record={record}
                     onCopy={copyToClipboard}
                     displayLang={activeLang}
                   />
                 </>
               )}
             </div>
           </TabsContent>
            <TabsContent value="whatsapp" className="pt-4 space-y-4">
              {/* WhatsApp / Viber Number Info */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500">{t('WhatsApp / Viber 号码')}</p>
                  {chatPhone ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-slate-700 font-medium">{chatPhone}</span>
                      {record.phoneType && (
                        <Badge variant="secondary" className="text-xs">
                          {record.phoneType === 'mobile'
                            ? t('手机号')
                            : record.phoneType === 'landline'
                              ? t('座机')
                              : t('未知类型')}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">{t('暂无可用号码')}</p>
                  )}
                  {landline && (
                    <p className="text-xs text-amber-600">
                      {t('该号码为座机号，WhatsApp 可能无法使用；Viber 仍可尝试')}
                    </p>
                  )}
                </div>
                {record.normalizedPhone &&
                  record.normalizedPhone !== record.normalizedWhatsappPhone && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500">{t('原始电话号码')}</p>
                      <p className="text-sm text-slate-700">{record.normalizedPhone}</p>
                    </div>
                  )}
              </div>
              {/* Chat Language Toggle */}
             {hasWhatsAppMessage && (
               <div className="flex items-center gap-2">
                 <span className="text-xs text-slate-500">{t('语言：')}</span>
                 <div className="inline-flex rounded-md overflow-hidden border border-slate-200">
                   <button
                     type="button"
                     onClick={() => setWhatsAppLang((prev) => ({ ...prev, [record.id]: 'local' }))}
                     disabled={!hasWhatsAppLocal}
                     className={`px-3 py-1 text-xs font-medium transition-colors ${
                       waLang === 'local'
                         ? 'bg-green-600 text-white'
                         : hasWhatsAppLocal
                           ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                           : 'bg-slate-50 text-slate-300 cursor-not-allowed'
                     }`}
                   >
                     {t('本地语言')}
                   </button>
                   <button
                     type="button"
                     onClick={() => setWhatsAppLang((prev) => ({ ...prev, [record.id]: 'en' }))}
                     className={`px-3 py-1 text-xs font-medium transition-colors ${
                       waLang === 'en'
                         ? 'bg-green-600 text-white'
                         : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                     }`}
                   >
                     English
                   </button>
                 </div>
                 {!hasWhatsAppLocal && (
                   <span className="text-xs text-slate-400">{t('（暂无本地语言版本）')}</span>
                 )}
               </div>
             )}
             <div className="space-y-1">
               <p className="text-xs font-medium text-slate-500">
                 {t('IM 话术（WhatsApp / Viber 通用）')}
               </p>
               {hasWhatsAppMessage ? (
                 <div className="rounded-md border border-green-200 bg-green-50 p-3 min-h-[120px]">
                   <p className="text-sm text-slate-700 whitespace-pre-wrap">
                     {waDetailMessage}
                   </p>
                 </div>
               ) : (
                 <div className="rounded-md border border-slate-200 bg-slate-50 p-3 min-h-[120px] flex items-center justify-center">
                   <p className="text-sm text-slate-400">
                     {hasChat
                       ? t('尚未生成 IM 话术')
                       : t('暂无电话，无法使用 WhatsApp / Viber')}
                   </p>
                 </div>
               )}
             </div>
             <div className="flex gap-2 justify-end flex-wrap">
               {hasWhatsAppMessage ? (
                 <>
                   <Button
                     variant="outline"
                     size="sm"
                     onClick={() => void copyToClipboard(waDetailMessage, t('IM 话术（WhatsApp / Viber 通用）'))}
                   >
                     <Copy size={14} />
                     {t('复制话术')}
                   </Button>
                   <Button
                     variant="default"
                     size="sm"
                    onClick={() => void openChat('whatsapp', record, waLang)}
                    disabled={!hasWhatsApp}
                     className="bg-green-600 hover:bg-green-700"
                   >
                     <Send size={14} />
                     {t('打开 WhatsApp')}
                   </Button>
                   <Button
                     variant="default"
                     size="sm"
                    onClick={() => void openChat('viber', record, waLang)}
                    disabled={!hasViber}
                     className="bg-[#7360DF] hover:bg-[#5d4dcf] text-white"
                   >
                     <Send size={14} />
                     {t('打开 Viber')}
                   </Button>
                 </>
               ) : hasChat ? (
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={() => onGenerateWhatsApp(record)}
                   disabled={generatingWhatsAppId === record.id}
                   className="text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
                 >
                   {generatingWhatsAppId === record.id ? (
                     <Loader2 className="animate-spin" size={14} />
                   ) : (
                     <MessageCircle size={14} />
                   )}
                   {t('生成 IM 话术')}
                 </Button>
               ) : null}
             </div>
           </TabsContent>
         </Tabs>
      </div>
    );
  };

  // noEmailFilter is applied server-side via the stats filter; kept in props for parity.
  void noEmailFilter;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7"
        data-ai-section-type="card-stat"
      >
         {statCards.map((stat) => {
           const isActive = filterKey === stat.key;
           return (
             <div
               key={stat.label}
               onClick={() => onStatClick(stat.key)}
               className={`rounded-lg border bg-white p-5 shadow-sm cursor-pointer transition-colors hover:shadow-md ${
                 isActive ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
               }`}
             >
               <p className="text-sm text-slate-500">{stat.label}</p>
               <p className={`mt-2 text-2xl font-bold ${stat.color}`}>
                 {stat.value}
               </p>
             </div>
           );
         })}
      </div>

      {/* Active Filter Chip */}
      {activeFilterLabel && (
        <div className="flex items-center">
          <span className="bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-3 py-1 text-sm inline-flex items-center gap-1">
            {activeFilterLabel}
            <button
              onClick={() => onStatClick('all')}
              className="ml-1 text-blue-500 hover:text-blue-700 inline-flex items-center"
              aria-label={t('清除筛选')}
            >
              <X size={14} />
            </button>
          </span>
        </div>
      )}

      {/* Toolbar + Table */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="default"
              onClick={onImportClick}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onImportDrop}
            >
              <Upload size={16} />
              {t('导入名录')}
            </Button>

            {/* Status filter */}
            <div className="w-[140px]">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilterValue)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('状态筛选')} />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div className="relative w-[240px]">
              <Input
                placeholder={t('按名称搜索')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSearch();
                }}
                className="pl-9"
              />
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={onSearch}>
              {t('搜索')}
            </Button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="secondary"
              onClick={() => batchAnalyzeOp.start()}
              disabled={batchAnalyzeOp.isRunning || items.length === 0 || batchGenerateOp.isRunning || batchWhatsAppOp.isRunning}
            >
              {batchAnalyzeOp.isRunning ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Play size={16} />
              )}
              {batchAnalyzeOp.isRunning
                ? t('分析中 {p}/{t}（{percent}%）', {
                    p: batchAnalyzeOp.processed + batchAnalyzeOp.failed,
                    t: batchAnalyzeOp.total,
                    percent: batchAnalyzeOp.progress,
                  })
                : t('一键分析全部')}
            </Button>
            <Button
              variant="default"
              onClick={() => batchGenerateOp.start()}
              disabled={batchGenerateOp.isRunning || items.length === 0 || batchAnalyzeOp.isRunning || batchWhatsAppOp.isRunning}
            >
              {batchGenerateOp.isRunning ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Mail size={16} />
              )}
              {batchGenerateOp.isRunning
                ? t('生成中 {p}/{t}（{percent}%）', {
                    p: batchGenerateOp.processed + batchGenerateOp.failed,
                    t: batchGenerateOp.total,
                    percent: batchGenerateOp.progress,
                  })
                : t('一键生成全部')}
            </Button>
            <Button
              variant="outline"
              onClick={() => batchWhatsAppOp.start()}
              disabled={batchWhatsAppOp.isRunning || items.length === 0 || batchAnalyzeOp.isRunning || batchGenerateOp.isRunning}
              className="text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
            >
              {batchWhatsAppOp.isRunning ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <MessageCircle size={16} />
              )}
              {batchWhatsAppOp.isRunning
                ? t('准备中 {p}/{t}（{percent}%）', {
                    p: batchWhatsAppOp.processed + batchWhatsAppOp.failed,
                    t: batchWhatsAppOp.total,
                    percent: batchWhatsAppOp.progress,
                  })
                : t('一键准备 IM 话术')}
            </Button>
          </div>
        </div>

        {/* Batch progress bar */}
        {(batchAnalyzeOp.isRunning || batchGenerateOp.isRunning || batchWhatsAppOp.isRunning) && (
          <div className="mb-4">
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${
                    batchAnalyzeOp.isRunning
                      ? batchAnalyzeOp.progress
                      : batchGenerateOp.isRunning
                      ? batchGenerateOp.progress
                      : batchWhatsAppOp.progress
                  }%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-xs text-slate-500">
              <span>
                {batchAnalyzeOp.isRunning
                  ? t('正在分析网站...')
                  : batchGenerateOp.isRunning
                  ? t('正在生成邮件...')
                  : t('正在准备 IM 话术...')}
              </span>
              <span>
                {t('已处理 {p}/{t}（{percent}%）', {
                  p:
                    batchAnalyzeOp.processed + batchAnalyzeOp.failed ||
                    batchGenerateOp.processed + batchGenerateOp.failed ||
                    batchWhatsAppOp.processed + batchWhatsAppOp.failed,
                  t:
                    batchAnalyzeOp.total ||
                    batchGenerateOp.total ||
                    batchWhatsAppOp.total,
                  percent:
                    batchAnalyzeOp.progress ||
                    batchGenerateOp.progress ||
                    batchWhatsAppOp.progress,
                })}
              </span>
            </div>
          </div>
        )}

        {/* Table */}
        <Table<Company>
          columns={columns}
          dataSource={listData?.items || []}
          loading={listLoading}
          rowKey="id"
          scroll={{ x: 1200, y: 500 }}
          expandable={{
            expandedRowRender,
          }}
          pagination={{
            current: page,
            pageSize,
            total: listData?.total || 0,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (total: number) => t('共 {n} 条', { n: total }),
          }}
        />
      </div>
    </div>
  );
};

export default WorkbenchTab;
