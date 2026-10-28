import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Table, TableProps } from '@lark-apaas/client-toolkit/antd-table';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Paperclip,
  Send,
  Settings2,
  RotateCcw,
  ChevronDown,
  Check,
} from 'lucide-react';

import * as websiteAnalyzerApi from '@client/src/api/website-analyzer';
import { getCompanyContacts } from '@client/src/api/website-analyzer';
import { canonicalizeCountry, countryFlag } from '@shared/countries';
import * as emailGeneratorApi from '@client/src/api/email-generator';
import * as adminApi from '@client/src/api/admin';
import * as senderProfilesApi from '@client/src/api/sender-profiles';
import * as projectsApi from '@client/src/api/projects';
import RichEmailEditor, { textToEditorHtml } from '@client/src/components/RichEmailEditor';
import EmailBodyPreview from '@client/src/components/EmailBodyPreview';
import EmailChipInput from '@client/src/components/EmailChipInput';
import { getSendOptions, saveSendOptions, uploadAttachment } from '@client/src/api/sender-profiles';
import type { SenderProfile } from '@client/src/api/sender-profiles';
import { getCompanies } from '@client/src/api/restaurants';
import EmailBodyView from './EmailBodyView';
import { hasImageMarkers } from '@client/src/utils/email-body';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { errMessage } from '@client/src/utils/err-message';
import { uploadSizeError } from '@client/src/utils/upload-guard';
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
import { Popover, PopoverTrigger, PopoverContent } from '@client/src/components/ui/popover';
import { Slider } from '@client/src/components/ui/slider';
import { EmailHistoryList } from '@client/src/components/EmailHistoryList';
import { getCompanyEmailHistories } from '@client/src/api/email-generator';

type StatusFilterValue = CompanyStatus | 'all';

/** 列宽调节弹层里的中文列名（key → 翻译 key，t() 外面再包一层） */
const COL_WIDTH_LABELS: Record<string, string> = {
  star: '星标',
  seqNo: '序号',
  name: '名称',
  country: '国家/地区',
  websiteBusinessType: '业务类型',
  email: '邮箱',
  website: '网站',
  phone: '电话',
  status: '状态',
  action: '操作',
};

/** 工作台表格列宽：默认值 / 下限 / 中文列名（列宽调节弹层与拖拽把手共用） */
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  star: 44,
  seqNo: 70,
  name: 220,
  country: 100,
  websiteBusinessType: 140,
  email: 200,
  website: 200,
  phone: 160,
  status: 160,
  action: 560,
};
const COL_MIN_WIDTH: Record<string, number> = {
  star: 36,
  seqNo: 50,
  name: 120,
  country: 70,
  websiteBusinessType: 90,
  email: 120,
  website: 100,
  phone: 110,
  status: 110,
  action: 320,
};

/**
 * 公司行的联系方式区：把分析时从官网抓到的**全部**邮箱/电话都列出来
 * （很多公司有总机、传真、多个分部电话，只显示一个会漏掉可用的）。
 */
const CompanyContacts: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ['company-contacts', companyId],
    queryFn: () => getCompanyContacts(companyId),
    staleTime: 60_000,
  });
  const items = data ?? [];
  if (items.length === 0) return null;
  const emails = items.filter((c) => c.type === 'email');
  const phones = items.filter((c) => c.type === 'phone');
  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-3">
      <p className="text-xs font-medium text-slate-500">{t('全部联系方式')}</p>
      {emails.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">{t('邮箱')}</span>
          {emails.map((c) => (
            <span
              key={`e-${c.value}`}
              className="rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700 break-all"
            >
              {c.value}
              {c.isPrimary && <span className="ml-1 text-[10px] text-primary">{t('主')}</span>}
            </span>
          ))}
        </div>
      )}
      {phones.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">{t('电话')}</span>
          {phones.map((c) => (
            <span
              key={`p-${c.value}`}
              className="rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700 break-all"
            >
              {c.value}
              {c.isPrimary && <span className="ml-1 text-[10px] text-primary">{t('主')}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 公司行的往来记录区：发信 + 收信全量历史（后台 IMAP 自动抓取）。
 */
const CompanyEmailHistory: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ['company-email-history', companyId],
    queryFn: () => getCompanyEmailHistories(companyId),
    staleTime: 30_000,
  });
  const items = data?.items ?? [];
  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-3">
      <p className="text-xs font-medium text-slate-500">{t('往来记录')}</p>
      {isLoading ? (
        <p className="text-xs text-slate-400">{t('加载中...')}</p>
      ) : (
        <EmailHistoryList
          items={items}
          emptyText={t('暂无往来记录：发送邮件或收到回复后会显示在这里')}
          maxHeight="max-h-48"
        />
      )}
    </div>
  );
};

/**
 * 可拖拽宽度的表头单元格（antd v5 components.header.cell 自定义）。 * onHeaderCell 返回的 width/onResize 等自定义 prop 会被合并进本组件 props，
 * 本组件负责渲染右侧拖拽把手；自定义 prop 不会透传到 DOM（避免 React 警告）。
 */
interface ResizableHeaderCellProps extends React.HTMLAttributes<HTMLTableCellElement> {
  width?: number;
  onResize?: (width: number) => void;
  minWidth?: number;
  resizable?: boolean;
  resizeHint: string;
  /** 把手在单元格哪一侧。固定右列用 'left'（其右边缘贴着视口右边，用户够不到） */
  handleSide?: 'left' | 'right';
  /** 反向拖动：固定右列拖左边缘时，向左拖应变宽 */
  invert?: boolean;
}

const ResizableHeaderCell: React.FC<ResizableHeaderCellProps> = ({
  width,
  onResize,
  minWidth = 60,
  resizable = true,
  resizeHint,
  handleSide = 'right',
  invert = false,
  children,
  ...restProps
}) => {
  const startRef = React.useRef<{ x: number; width: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onResize || width == null) return;
    startRef.current = { x: e.clientX, width };
    const onMove = (ev: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      const raw = ev.clientX - start.x;
      const next = Math.max(minWidth, start.width + (invert ? -raw : raw));
      onResize(next);
    };
    const onUp = () => {
      startRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('select-none');
    };
    document.body.classList.add('select-none');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <th {...restProps} className={`${restProps.className ?? ''} relative`}>
      {children}
      {resizable && onResize && (
        <span
          role="separator"
          aria-orientation="vertical"
          title={resizeHint}
          onMouseDown={handleMouseDown}
          className={`absolute top-0 z-10 h-full w-3 cursor-col-resize select-none border-slate-300 transition-colors hover:border-blue-500 hover:bg-blue-400/30 active:border-blue-600 active:bg-blue-500/40 ${
            handleSide === 'left' ? 'left-0 border-l-2' : 'right-0 border-r-2'
          }`}
        />
      )}
    </th>
  );
};

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
  /** 国家筛选（'' = 全部）；选项由 stats.countries 动态生成 */
  countryFilter: string;
  onCountryFilterChange: (country: string) => void;
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
  countryFilter,
  onCountryFilterChange,
  onToggleStar,
  onUpdateContactStatus,
}) => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const qc = useQueryClient();

  const items = listData?.items || [];

  // --- 表格列宽（拖拽表头边缘 / 工具栏「列宽」按钮，按项目持久化） ---
  const widthStoreKey = `wb-col-widths-${projectId}`;
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = window.localStorage.getItem(widthStoreKey);
      if (raw) return { ...DEFAULT_COL_WIDTHS, ...(JSON.parse(raw) as Record<string, number>) };
    } catch {
      /* ignore */
    }
    return DEFAULT_COL_WIDTHS;
  });
  const setColWidth = useCallback((key: string, width: number) => {
    setColWidths((prev) => {
      const next = { ...prev, [key]: width };
      try {
        window.localStorage.setItem(widthStoreKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [widthStoreKey]);
  const resetColWidths = useCallback(() => {
    setColWidths(DEFAULT_COL_WIDTHS);
    try {
      window.localStorage.removeItem(widthStoreKey);
    } catch {
      /* ignore */
    }
  }, [widthStoreKey]);

  // --- Batch analyze operation ---
  // --- 行选择：批量操作只作用于本页勾选的公司 ---
  // 未勾选时回退到"当前筛选结果"（原行为），勾选后严格只跑勾选项。
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 有勾选时，IM 话术/生成/发送都只跑勾选项；没勾选才用当前筛选结果
  const batchItems = useMemo(
    () => (selectedIds.length > 0 ? items.filter((c) => selectedIds.includes(c.id)) : items),
    [items, selectedIds],
  );
  const batchAnalyzeOp = useBatchOperation<Company>({
    items: batchItems,
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

  // 「一键分析全部」两段式：
  // 1) 分析项目里所有未分析（待分析 + 失败）的公司，跨分页拉全、不设上限；
  // 2) 邮箱核验：重扫全部公司官网 —— 已有邮箱的核验准确性（官网出现更优邮箱则替换），
  //    没邮箱的尝试从官网挖。纯 HTTP 不调 AI，与第 1 步并行执行。
  const [analyzeAllPreparing, setAnalyzeAllPreparing] = useState(false);
  const [emailRescanRunning, setEmailRescanRunning] = useState(false);
  // 「一键分析全部」的取数范围：默认只跑未分析的（与历史行为一致），
  // 也可选只重跑已分析过的（换分析逻辑后重新抓联系方式），或全部。
  type AnalyzeScope = 'unanalyzed' | 'analyzed' | 'all';
  const [analyzeScope, setAnalyzeScope] = useState<AnalyzeScope>('unanalyzed');
  const ANALYZE_SCOPE_STATUSES: Record<AnalyzeScope, CompanyStatus[]> = {
    unanalyzed: ['pending', 'failed'],
    analyzed: ['analyzed', 'generating', 'generated'],
    all: ['pending', 'failed', 'analyzed', 'generating', 'generated'],
  };
  /** 下拉菜单里显示的选项（label 走 t() 翻译） */
  const ANALYZE_SCOPE_OPTIONS: { value: AnalyzeScope; label: string }[] = [
    { value: 'unanalyzed', label: '未分析的' },
    { value: 'analyzed', label: '已分析的' },
    { value: 'all', label: '全部' },
  ];
  const handleAnalyzeAll = useCallback(async () => {
    setAnalyzeAllPreparing(true);
    try {
      const seen = new Map<string, Company>();
      for (const status of ANALYZE_SCOPE_STATUSES[analyzeScope]) {
        let page = 1;
        for (;;) {
          const res = await getCompanies({ projectId, page, pageSize: 100, status });
          for (const c of res.items) seen.set(c.id, c);
          if (res.items.length === 0 || page * 100 >= res.total) break;
          page += 1;
        }
      }
      let targets = [...seen.values()];
      // 有勾选时只分析勾选项（跨分页保留勾选，故 selectedIds 可能不在当前页）
      if (selectedIds.length > 0) {
        const picked = new Set(selectedIds);
        targets = targets.filter((c) => picked.has(c.id));
      }
      if (targets.length === 0) {
        toast.info(t('该范围内没有需要分析的公司'));
      } else {
        batchAnalyzeOp.start(targets);
      }
    } catch (err: unknown) {
      logger.error('获取待分析公司列表失败', err);
      toast.error(t('获取待分析列表失败，请重试'));
      setAnalyzeAllPreparing(false);
      return;
    }
    setAnalyzeAllPreparing(false);

    // 邮箱核验（不依赖第 1 步结果，全部公司都重扫）
    setEmailRescanRunning(true);
    try {
      const summary = await websiteAnalyzerApi.rescanEmails(projectId);
      void qc.invalidateQueries({ queryKey: ['companies'] });
      void qc.invalidateQueries({ queryKey: ['company-stats'] });
      if (summary.updated + summary.added > 0) {
        toast.success(
          t('邮箱核验完成：扫描 {s} 个网站，替换 {u} 家、新找到 {a} 家的邮箱', {
            s: summary.scanned,
            u: summary.updated,
            a: summary.added,
          }),
        );
      } else {
        toast.info(
          t('邮箱核验完成：{s} 个网站中没有发现可更新的邮箱', { s: summary.scanned }),
        );
      }
    } catch (err: unknown) {
      logger.error('邮箱核验失败', err);
      toast.error(t('邮箱核验失败，请稍后重试'));
    } finally {
      setEmailRescanRunning(false);
    }
  }, [projectId, batchAnalyzeOp, t, qc]);

  // --- Batch generate email operation ---
  // 「一键生成全部」只圈「已分析 + 有邮箱 + 尚未生成」的公司：
  // 没有收件人生成邮件是纯烧 AI 额度；生成接口本身不检查邮箱也不发信，
  // 所以无邮箱的公司以前也会"成功"——这是漏洞不是功能。
  const skippedNoEmailRef = useRef(0);
  const batchGenerateOp = useBatchOperation<Company>({
    items: batchItems,
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
      const skipped = skippedNoEmailRef.current;
      const suffix = skipped > 0 ? t('；已跳过无邮箱 {n} 家', { n: skipped }) : '';
      if (failed > 0) {
        toast.warning(
          t('批量生成完成：成功 {s} 条，失败 {f} 条', { s: success, f: failed }) + suffix,
        );
      } else {
        toast.success(t('批量生成完成：共 {s} 条全部成功', { s: success }) + suffix);
      }
      skippedNoEmailRef.current = 0;
    },
  });

  const [generateAllPreparing, setGenerateAllPreparing] = useState(false);
  const handleGenerateAll = useCallback(async () => {
    setGenerateAllPreparing(true);
    try {
      const seen = new Map<string, Company>();
      let noEmail = 0;
      let page = 1;
      // 生成只对 analyzed 状态有意义（failed 需要先重新分析；generated 有行内重新生成按钮）。
      // generating 也要圈进来：它是"进行中"标记，若上次请求被部署/刷新打断就会永久卡住
      // （服务端 batchGenerate 只选 analyzed），不圈进来这些公司永远重试不了。
      for (const status of ['analyzed', 'generating'] as const) {
        page = 1;
        for (;;) {
          const res = await getCompanies({ projectId, page, pageSize: 100, status });
          for (const c of res.items) {
            seen.set(c.id, c);
            if (!(c.websiteContactEmail || c.email)) noEmail += 1;
          }
          if (res.items.length === 0 || page * 100 >= res.total) break;
          page += 1;
        }
      }
      const targets = [...seen.values()].filter((c) => c.websiteContactEmail || c.email);
      if (targets.length === 0) {
        skippedNoEmailRef.current = 0;
        toast.info(t('没有可生成邮件的公司（需要已分析且有邮箱）'));
        return;
      }
      skippedNoEmailRef.current = noEmail;
      batchGenerateOp.start(targets);
    } catch (err: unknown) {
      logger.error('获取可生成公司列表失败', err);
      toast.error(t('获取待分析列表失败，请重试'));
    } finally {
      setGenerateAllPreparing(false);
    }
  }, [projectId, batchGenerateOp, t]);

  // 批量操作的语言版本（按钮右侧下拉选择）：
  // - sendLang：一键发送实际发出哪个语言版本（local=收件人本地语言，en=英文）
  // - whatsAppBatchLang：一键准备 IM 话术后，哪一版作为该公司当前展示/复制的话术
  const [sendLang, setSendLang] = useState<'local' | 'en'>('local');
  const [whatsAppBatchLang, setWhatsAppBatchLang] = useState<'local' | 'en'>('local');
  // 每家公司当前预览/编辑的语言。既是展开行的显示语言，也是批量发送时该公司的实际语言，
  // 保证「预览看到哪一版 == 实际发出哪一版」。
  const [emailDisplayLang, setEmailDisplayLang] = useState<Record<string, 'local' | 'en'>>({});
  // 每家公司当前展示/复制的话术语言（批量准备时按下拉选中的语言写入）
  const [whatsAppLang, setWhatsAppLang] = useState<Record<string, 'local' | 'en'>>({});

  // --- Batch WhatsApp operation ---
  const batchWhatsAppOp = useBatchOperation<Company>({
    items: batchItems,
    getItemId: (item: Company) => item.id,
    operation: async (item: Company) => {
      const result = await emailGeneratorApi.generateWhatsApp(item.id);
      // 话术两版都会生成；把下拉选中的语言设成该公司的当前展示/复制版本
      setWhatsAppLang((prev) => ({ ...prev, [item.id]: whatsAppBatchLang }));
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

  // --- Active batch operation ---
  // Only one batch job can run at a time; pick the running one explicitly. The
  // previous `a || b || c` chain fell through whenever the running job had a
  // zero counter and therefore displayed another job's numbers.
  const activeBatchOp = batchAnalyzeOp.isRunning
    ? batchAnalyzeOp
    : batchGenerateOp.isRunning
      ? batchGenerateOp
      : batchWhatsAppOp;
  const activeBatchProcessed = activeBatchOp.processed + activeBatchOp.failed;
  const activeBatchTotal = activeBatchOp.total;
  const activeBatchProgress = activeBatchOp.progress;


  // --- 一键发送（SMTP 直发） ---
  // 服务端圈定目标：已生成邮件 + 有邮箱 + 未发送过（emailContactedAt 为空）。
  const [sendAllRunning, setSendAllRunning] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  // 发信账号（多邮箱后缀）：'' = 用默认账号
  const [sendAccountId, setSendAccountId] = useState('');
  const bodyEditRef = useRef<HTMLTextAreaElement>(null);
  const [insertRequest, setInsertRequest] = useState<{ html: string; nonce: number } | null>(null);
  // 号码注册检测结果（WhatsApp / Viber）
  const { data: messengerStatus, refetch: refetchMessengerStatus } = useQuery({
    queryKey: ['messenger-status', projectId],
    queryFn: () => emailGeneratorApi.listMessengerStatus(projectId),
    staleTime: 5 * 60_000,
  });
  const messengerMap = useMemo(() => {
    const m = new Map<string, emailGeneratorApi.MessengerStatus>();
    for (const st of messengerStatus || []) m.set(st.companyId, st);
    return m;
  }, [messengerStatus]);
  const [checkingMessenger, setCheckingMessenger] = useState(false);
  const [editCc, setEditCc] = useState('');
  const [editBcc, setEditBcc] = useState('');
  const { data: projectImages = [] } = useQuery({
    queryKey: ['project-image-materials', projectId],
    queryFn: async () => {
      const p = await projectsApi.getProject(projectId);
      return (p.materials || [])
        .filter((m) => m.fileType === 'image')
        .map((m) => ({
          materialId: m.id,
          fileName: m.fileName,
          description: (m.imageDescription || '').replace(/^(manual|vision|fallback):/, ''),
        }));
    },
    staleTime: 60_000,
  });
  const [sendAccounts, setSendAccounts] = useState<adminApi.SmtpAccount[]>([]);
  const [sendProfiles, setSendProfiles] = useState<SenderProfile[]>([]);
  const [sendProfileId, setSendProfileId] = useState('');
  useEffect(() => {
    void adminApi
      .listSmtpAccounts()
      .then(setSendAccounts)
      .catch(() => setSendAccounts([]));
    void senderProfilesApi
      .listProfiles()
      .then(setSendProfiles)
      .catch(() => setSendProfiles([]));
  }, []);
  const handleSendAll = useCallback(async () => {
    setSendAllRunning(true);
    try {
      const summary = await emailGeneratorApi.batchSendEmails(
        projectId,
        sendLang,
        emailDisplayLang,
        selectedIds.length > 0 ? selectedIds : undefined,
        sendAccountId || undefined,
        sendProfileId || undefined,
      );
      void qc.invalidateQueries({ queryKey: ['companies'] });
      void qc.invalidateQueries({ queryKey: ['company-stats'] });
      if (summary.eligible === 0) {
        toast.info(t('没有可发送的邮件（需要已生成、有邮箱且未发送过）'));
      } else if (summary.failed > 0) {
        toast.warning(
          t('批量发送完成：成功 {s} 封，失败 {f} 封', { s: summary.sent, f: summary.failed }),
        );
        if (summary.errors.length > 0) {
          toast.error(
            t('发送失败详情：{list}', {
              list: summary.errors.slice(0, 3).map((e) => `${e.name}: ${e.error}`).join('；'),
            }),
          );
        }
      } else {
        toast.success(t('批量发送完成：{s} 封全部发送成功', { s: summary.sent }));
      }
    } catch (err: unknown) {
      logger.error('批量发送失败', err);
      toast.error(t('批量发送失败，请检查发信服务配置后重试'));
    } finally {
      setSendAllRunning(false);
    }
  }, [projectId, t, qc, sendLang, emailDisplayLang]);

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
      notContacted: 0,
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
      { key: 'has_email' as const, label: t('有邮箱'), value: data.total - data.noEmail, color: 'text-emerald-600' },
      { key: 'not_contacted' as const, label: t('未联系'), value: data.notContacted, color: 'text-red-600' },
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
      has_email: t('有邮箱'),
      no_email: t('缺邮箱'),
      not_contacted: t('未联系'),
      failed: t('分析失败'),
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
  const getEmailDisplayLang = (record: Company): 'local' | 'en' => {
    if (emailDisplayLang[record.id]) return emailDisplayLang[record.id];
    // 没手动切过的行，默认跟随「一键发送」的批量语言选择（缺该语言版本时回退另一版）。
    // 这样预览与实际发送永远同源，符合"所见即所发"；服务端 pickEmailVersion 的回退规则与此一致。
    if (sendLang === 'en') return record.emailSubject ? 'en' : 'local';
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
    // 编辑器只认 HTML：纯文本（AI 生成的）先转成段落 HTML
    const toHtml = (v: string | undefined | null): string => {
      if (!v) return '';
      if (v.trimStart().startsWith('<!--html-->')) return v.trimStart().slice(11);
      return textToEditorHtml(v);
    };
    setEditingEmail({
      subject: record.emailSubject || '',
      body: toHtml(record.emailBody),
      subjectLocal: record.emailSubjectLocal || '',
      bodyLocal: toHtml(record.emailBodyLocal),
    });
    // 载入该公司已存的抄送/密送
    void getSendOptions(record.id)
      .then((o) => {
        setEditCc(o.cc || '');
        setEditBcc(o.bcc || '');
      })
      .catch(() => undefined);
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
      // 显示国旗 + 归并后的规范名：导入时塞尔维亚可能被填成 Serbia / Srbija /
      // Србија / 塞尔维亚，列里应该都是同一个国旗 + 同一个名字。
      render: (val: string | null) => {
        if (!val) return <span className="text-slate-400">-</span>;
        const canonical = canonicalizeCountry(val);
        const flag = countryFlag(val);
        const label = canonical ?? val;
        return (
          <span className="whitespace-nowrap">
            {flag && <span className="mr-1">{flag}</span>}
            {label}
          </span>
        );
      },
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
      // 与「有邮箱」筛选/发送同口径：websiteContactEmail 优先（官网核验/挖掘的结果），
      // 否则用导入的 email 列
      render: (val: string | null, record: Company) => {
        const effective = record.websiteContactEmail || val;
        return effective ? (
          <span className="text-slate-700">{effective}</span>
        ) : (
          <span className="text-slate-400">-</span>
        );
      },
    },
    {
      title: t('网站'),
      dataIndex: 'website',
      key: 'website',
      width: 200,
      ellipsis: true,
      // 官网直接可点，方便核对公司真伪 / 手动补查
      render: (val: string | null) => {
        const url = (val || '').trim();
        if (!url) return <span className="text-slate-400">-</span>;
        const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {url}
          </a>
        );
      },
    },
    {
      title: t('电话'),
      dataIndex: 'phone',
      key: 'phone',
      width: 160,
      ellipsis: true,
      // 与邮箱同口径：websiteContactPhone 优先（官网核验/挖掘的结果），否则用导入的 phone 列
      render: (val: string | null, record: Company) => {
        const effective = record.websiteContactPhone || val;
        return effective ? (
          <span className="text-slate-700">{effective}</span>
        ) : (
          <span className="text-slate-400">-</span>
        );
      },
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
          ? buildWhatsAppUrl(toDigits(waPhone), waMessage)
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
                      void emailGeneratorApi
                        .downloadEml(record.id)
                        .catch((err: unknown) => {
                          logger.error('下载 .eml 失败', err);
                          toast.error(t('下载失败，请稍后重试'));
                        });
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

  // 应用列宽 + 挂拖拽把手：antd 用 column.width 渲染 colgroup，改 state 即实时生效
  const effectiveColumns = useMemo(() => {
    return columns.map((col) => {
      const key = String((col as { key?: string }).key ?? '');
      const width = colWidths[key] ?? (col as { width?: number }).width;
      const resizable = key !== '' && key !== 'star';
      // 固定右列（操作）右边缘贴着视口右边，用户够不到；把手改到左边缘并反向拖动。
      // 同时抬高该表头的 z-index，盖住被它遮住的中列把手（否则那些把手会浮在上层，
      // 在表头里留下一道道看似可拖、实则错位的竖线）。
      const isRightFixed = (col as { fixed?: string }).fixed === 'right';
      return {
        ...col,
        width,
        onHeaderCell: () =>
          ({
            width,
            minWidth: COL_MIN_WIDTH[key] ?? 60,
            resizable,
            resizeHint: t('拖动调节列宽'),
            handleSide: isRightFixed ? 'left' : 'right',
            invert: isRightFixed,
            ...(isRightFixed ? { style: { zIndex: 11 } } : {}),
            onResize: (w: number) => setColWidth(key, w),
          }) as React.HTMLAttributes<HTMLTableCellElement>,
      } as unknown as (typeof columns)[number];
    });
  }, [columns, colWidths, setColWidth, t]);

  const totalColWidth = useMemo(
    () => Object.values(colWidths).reduce((sum, w) => sum + w, 0),
    [colWidths],
  );

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
                 <>
                 {/* 抄送/密送：输入一个邮箱回车即成标签 */}
                 <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                   <EmailChipInput
                     label="CC"
                     value={editCc}
                     onChange={setEditCc}
                     placeholder={t('抄送地址，回车确认')}
                   />
                   <EmailChipInput
                     label="BCC"
                     value={editBcc}
                     onChange={setEditBcc}
                     placeholder={t('密送地址，回车确认')}
                   />
                 </div>

                 {/* 图片 / 附件：项目图片（按人工描述选）+ 本地上传图片 + 邮件附件 */}
                 <div className="flex flex-wrap items-center gap-2">
                   <select
                     className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
                     value=""
                     onChange={(e) => {
                       const materialId = e.target.value;
                       if (!materialId || !editingEmail) return;
                       const img = projectImages.find((x) => x.materialId === materialId);
                       const caption = img?.description || img?.fileName || '';
                       // 标记 + 图注，插入富文本编辑器光标处
                       const markerHtml =
                         `<p>[[IMG:${materialId}]]</p><p style="font-size:12px;color:#64748b">${caption}</p>`;
                       setInsertRequest((prev) => ({ html: markerHtml, nonce: (prev?.nonce ?? 0) + 1 }));
                       e.target.value = '';
                     }}
                   >
                     <option value="">{t('插入项目图片…')}</option>
                     {projectImages.map((img) => (
                       <option key={img.materialId} value={img.materialId}>
                         {img.fileName}
                         {img.description ? ` — ${img.description.slice(0, 40)}` : ''}
                       </option>
                     ))}
                   </select>
                   {/* 本地上传图片：存进项目素材并立即插入正文 */}
                   <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                     <Upload size={13} />
                     {t('上传图片到正文')}
                     <input
                       type="file"
                       accept="image/*"
                       className="hidden"
                       onChange={(e) => {
                         const f = e.target.files?.[0];
                         e.target.value = '';
                         if (!f || !editingEmail) return;
                         const sizeErr = uploadSizeError(f);
                         if (sizeErr) {
                           toast.error(sizeErr);
                           return;
                         }
                         void projectsApi
                           .uploadMaterial(projectId, f)
                           .then((m) => {
                             const markerHtml =
                               `<p>[[IMG:${m.id}]]</p><p style="font-size:12px;color:#64748b">${m.fileName}</p>`;
                             setInsertRequest((prev) => ({
                               html: markerHtml,
                               nonce: (prev?.nonce ?? 0) + 1,
                             }));
                             void qc.invalidateQueries({
                               queryKey: ['project-image-materials', projectId],
                             });
                             toast.success(t('图片已插入正文'));
                           })
                           .catch((err: unknown) => toast.error(errMessage(err, t('上传失败'))));
                       }}
                     />
                   </label>
                   {/* 邮件附件：随这封邮件发出 */}
                   <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                     <Paperclip size={13} />
                     {t('添加附件')}
                     <input
                       type="file"
                       className="hidden"
                       onChange={(e) => {
                         const f = e.target.files?.[0];
                         e.target.value = '';
                         if (!f || !editingEmail) return;
                         const sizeErr = uploadSizeError(f);
                         if (sizeErr) {
                           toast.error(sizeErr);
                           return;
                         }
                         void uploadAttachment(record.id, f)
                           .then(() => {
                             void qc.invalidateQueries({
                               queryKey: ['email-attachments', record.id],
                             });
                             toast.success(t('附件已添加'));
                           })
                           .catch((err: unknown) => toast.error(errMessage(err, t('上传失败'))));
                       }}
                     />
                   </label>
                   {projectImages.length === 0 && (
                     <span className="text-xs text-slate-400">
                       {t('此项目暂无图片素材——可在 Project info 上传并填写描述')}
                     </span>
                   )}
                 </div>
                 <RichEmailEditor
                   value={emailBody}
                   insertRequest={insertRequest}
                   onChange={(html) => {
                     if (!editingEmail) return;
                     if (editingEmailLanguage === 'local') {
                       setEditingEmail({ ...editingEmail, bodyLocal: html });
                     } else {
                       setEditingEmail({ ...editingEmail, body: html });
                     }
                   }}
                   placeholder={t('请输入邮件正文')}
                 />
                 {/* 实时预览：标记位置显示真实图片，确认图片是"进正文"而不是附件 */}
                 <EmailBodyPreview html={emailBody} projectId={projectId} />
                 {hasImageMarkers(emailBody) && (
                   <p className="text-xs text-slate-400">
                     {t('邮件中的图片以 [[IMG:...]] 标记占位（其下一行为图注），编辑时请保留这些行')}
                   </p>
                 )}
                 </>
               ) : (
                 <div className="rounded-md border border-slate-200 bg-slate-50 p-3 min-h-[200px]">
                   {emailBody ? (
                     <EmailBodyView body={emailBody} projectId={record.projectId} />
                   ) : (
                     <p className="text-sm text-slate-700">{t('暂无邮件内容')}</p>
                   )}
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
                     onClick={() => {
                       // 抄送/密送随邮件一起保存（每公司独立）
                       void saveSendOptions(record.id, { cc: editCc, bcc: editBcc }).catch(() => undefined);
                       onSaveEmail(record);
                     }}
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
                    // 无邮箱不生成：服务端也会拦，这里先禁用并说明原因
                    disabled={
                      generatingId === record.id ||
                      !(record.websiteContactEmail || record.email)
                    }
                    title={
                      record.websiteContactEmail || record.email
                        ? undefined
                        : t('该公司没有邮箱地址，无法生成邮件')
                    }
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

            {/* 抓到的全部联系方式（多个邮箱/电话都要列出来，主值标"主"） */}
            <CompanyContacts companyId={record.id} />

            {/* 往来记录（发信/收信全量历史，后台 IMAP 自动收取） */}
            <CompanyEmailHistory companyId={record.id} />
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
               {hasChat && (
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={() => onGenerateWhatsApp(record)}
                   disabled={generatingWhatsAppId === record.id}
                 >
                   {generatingWhatsAppId === record.id ? (
                     <Loader2 className="animate-spin" size={14} />
                   ) : (
                     <RefreshCw size={14} />
                   )}
                   {hasWhatsAppMessage ? t('重新生成话术') : t('生成话术')}
                 </Button>
               )}
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
                     title={(() => {
                       const st = messengerMap.get(record.id);
                       if (!st) return t('未检测');
                       if (st.whatsapp === 'yes') return t('号码检测：链接可用');
                       if (st.whatsapp === 'no') return t('号码检测：号码无效（不是有效号码）');
                       return t('号码检测：不确定——点开链接可自行确认');
                     })()}
                   >
                     <Send size={14} />
                     {t('打开 WhatsApp')}
                     {(() => {
                       const st = messengerMap.get(record.id);
                       if (!st) return null;
                       if (st.whatsapp === 'yes')
                         return <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-300" />;
                       if (st.whatsapp === 'no')
                         return <span className="ml-1 h-1.5 w-1.5 rounded-full bg-red-300" />;
                       return null;
                     })()}
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
           // 国家筛选挂在「总数量」卡里：这里最贴近"总数"的语义，
           // 且不破坏原有 7 列栅格（塞进卡片内部而不是新增一列）。
           const isTotalCard = stat.key === 'all';
           return (
             <div
               key={stat.label}
               onClick={() => onStatClick(stat.key)}
               className={`rounded-lg border bg-white p-5 shadow-sm cursor-pointer transition-colors hover:shadow-md ${
                 isActive ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
               }`}
             >
              {/* 第一排：标题 + 数字 */}
              <p className="text-sm text-slate-500">{stat.label}</p>
              <p className={`mt-2 text-2xl font-bold ${stat.color}`}>
                {stat.value}
              </p>
              {/* 第二排：国家筛选独占一行、撑满卡片宽（原来挤在标题右侧，又窄又难看） */}
              {isTotalCard && (
                <div
                  className="mt-3"
                  // stopPropagation：点筛选别连带触发"总数量"卡片自身的筛选
                  onClick={(e) => e.stopPropagation()}
                >
                  <Select
                    value={countryFilter || 'all'}
                    onValueChange={(v) => onCountryFilterChange(v === 'all' ? '' : v)}
                  >
                    <SelectTrigger
                      className="h-8 w-full text-xs"
                      aria-label={t('国家筛选')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('全部')}</SelectItem>
                      {(stats?.countries ?? []).map((c) => (
                        <SelectItem key={c.name} value={c.name}>
                          {c.flag ? `${c.flag} ` : ''}
                          {c.name}（{c.count}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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

            {/* 列宽调节：弹层逐列调 + 表头右缘直接拖 */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Settings2 size={14} />
                  {t('列宽')}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">{t('调节列宽')}</p>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={resetColWidths}>
                    <RotateCcw size={12} />
                    {t('重置')}
                  </Button>
                </div>
                {Object.entries(DEFAULT_COL_WIDTHS).map(([key, defWidth]) => {
                  // 原来这里是一条嵌套三元，漏掉的 key（phone 等）会掉到最后兜底成「操作」，
                  // 改成查表，新增列时漏配一眼能看出来。
                  const label =
                    COL_WIDTH_LABELS[key as keyof typeof COL_WIDTH_LABELS] ?? t(key);
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{label}</span>
                        <span className="tabular-nums">{colWidths[key] ?? defWidth}px</span>
                      </div>
                      <Slider
                        min={COL_MIN_WIDTH[key] ?? 60}
                        max={800}
                        step={10}
                        value={[colWidths[key] ?? defWidth]}
                        onValueChange={([v]) => setColWidth(key, v)}
                      />
                    </div>
                  );
                })}
                <p className="text-xs text-slate-400">{t('也可以直接拖动表头右缘调节列宽')}</p>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-stretch">
              <Button
                variant="secondary"
                onClick={() => void handleAnalyzeAll()}
                disabled={analyzeAllPreparing || emailRescanRunning || batchAnalyzeOp.isRunning || items.length === 0 || batchGenerateOp.isRunning || batchWhatsAppOp.isRunning}
                className="rounded-r-none"
              >
              {analyzeAllPreparing || emailRescanRunning || batchAnalyzeOp.isRunning ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Play size={16} />
              )}
              {analyzeAllPreparing
                ? t('正在获取待分析列表...')
                : emailRescanRunning
                  ? t('正在核验邮箱...')
                  : batchAnalyzeOp.isRunning
                    ? t('分析中 {p}/{t}（{percent}%）', {
                        p: batchAnalyzeOp.processed + batchAnalyzeOp.failed,
                        t: batchAnalyzeOp.total,
                        percent: batchAnalyzeOp.progress,
                      })
                    : t('一键分析全部')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  disabled={analyzeAllPreparing || batchAnalyzeOp.isRunning || emailRescanRunning}
                  className="rounded-l-none border-l-0 px-2"
                  aria-label={t('分析范围')}
                >
                  <ChevronDown size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>{t('分析范围')}</DropdownMenuLabel>
                {ANALYZE_SCOPE_OPTIONS.map((opt) => (
                  <DropdownMenuCheckboxItem
                    key={opt.value}
                    checked={analyzeScope === opt.value}
                    onCheckedChange={() => setAnalyzeScope(opt.value)}
                  >
                    {t(opt.label)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
            <Button
              variant="default"
              onClick={() => void handleGenerateAll()}
              disabled={generateAllPreparing || batchGenerateOp.isRunning || items.length === 0 || batchAnalyzeOp.isRunning || batchWhatsAppOp.isRunning}
            >
              {generateAllPreparing || batchGenerateOp.isRunning ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Mail size={16} />
              )}
              {generateAllPreparing
                ? t('正在获取可生成列表...')
                : batchGenerateOp.isRunning
                  ? t('生成中 {p}/{t}（{percent}%）', {
                      p: batchGenerateOp.processed + batchGenerateOp.failed,
                      t: batchGenerateOp.total,
                      percent: batchGenerateOp.progress,
                    })
                  : t('一键生成全部')}
            </Button>
            <div className="flex items-stretch">
              <Button
                variant="outline"
                onClick={() => {
                  // 生成话术的同时自动检测号码（WhatsApp 链接是否可用），
                  // 结果回写到行内按钮上——避免把时间浪费在无效号码上
                  void (async () => {
                    setCheckingMessenger(true);
                    try {
                      const sum = await emailGeneratorApi.checkMessengerBatch(projectId);
                      toast.success(
                        t('号码检测完成：{total} 个号码，链接可用 {yes} 个、无效 {no} 个、不确定 {unknown} 个', {
                          total: sum.total,
                          yes: sum.whatsappYes,
                          no: sum.whatsappNo,
                          unknown: sum.unknown,
                        }),
                      );
                      void refetchMessengerStatus();
                    } catch (err: unknown) {
                      toast.error(errMessage(err, t('号码检测失败')));
                    } finally {
                      setCheckingMessenger(false);
                      batchWhatsAppOp.start();
                    }
                  })();
                }}
                disabled={batchWhatsAppOp.isRunning || items.length === 0 || batchAnalyzeOp.isRunning || batchGenerateOp.isRunning}
                className="rounded-r-none text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={batchWhatsAppOp.isRunning || items.length === 0 || batchAnalyzeOp.isRunning || batchGenerateOp.isRunning}
                    className="rounded-l-none border-l-0 px-2 text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
                    title={t('选择话术语言')}
                  >
                    <ChevronDown size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setWhatsAppBatchLang('local')}>
                    {t('本地语言')}
                    {whatsAppBatchLang === 'local' ? <Check size={14} className="ml-auto" /> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setWhatsAppBatchLang('en')}>
                    English
                    {whatsAppBatchLang === 'en' ? <Check size={14} className="ml-auto" /> : null}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-stretch">
              <Button
                variant="default"
                onClick={() => setSendConfirmOpen(true)}
                disabled={sendAllRunning || batchAnalyzeOp.isRunning || batchGenerateOp.isRunning || batchWhatsAppOp.isRunning || items.length === 0}
                className="rounded-r-none bg-blue-600 hover:bg-blue-700 text-white"
              >
                {sendAllRunning ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Send size={16} />
                )}
                {sendAllRunning ? t('发送中...') : t('一键发送')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="default"
                    disabled={sendAllRunning || batchAnalyzeOp.isRunning || batchGenerateOp.isRunning || batchWhatsAppOp.isRunning || items.length === 0}
                    className="rounded-l-none border-l-0 border-blue-600 bg-blue-600 px-2 text-white hover:bg-blue-700"
                    title={t('选择发送语言')}
                  >
                    <ChevronDown size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t('发送语言')}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setSendLang('local')}>
                    {t('本地语言')}
                    {sendLang === 'local' ? <Check size={14} className="ml-auto" /> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSendLang('en')}>
                    English
                    {sendLang === 'en' ? <Check size={14} className="ml-auto" /> : null}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('选择发信人（签名身份）')}</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={sendProfileId === ''}
                    onCheckedChange={() => setSendProfileId('')}
                  >
                    {t('默认发信人档案')}
                  </DropdownMenuCheckboxItem>
                  {sendProfiles.map((p) => (
                    <DropdownMenuCheckboxItem
                      key={p.id}
                      checked={sendProfileId === p.id}
                      onCheckedChange={() => setSendProfileId(p.id)}
                    >
                      {p.profileName}
                      {p.isDefault ? ` ${t('（默认）')}` : ''}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('发信账号（邮箱后缀）')}</DropdownMenuLabel>
                  {sendAccounts.length === 0 ? (
                    <DropdownMenuItem disabled>
                      {t('未配置，将使用设置里的默认账号')}
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuCheckboxItem
                        checked={sendAccountId === ''}
                        onCheckedChange={() => setSendAccountId('')}
                      >
                        {t('默认账号')}
                      </DropdownMenuCheckboxItem>
                      {sendAccounts.map((a) => (
                        <DropdownMenuCheckboxItem
                          key={a.id}
                          checked={sendAccountId === a.id}
                          onCheckedChange={() => setSendAccountId(a.id)}
                        >
                          {a.email}
                          {a.isDefault ? ` ${t('（默认）')}` : ''}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* 一键发送确认：真实外发，必须显式确认 */}
        <Dialog open={sendConfirmOpen} onOpenChange={(v) => !sendAllRunning && setSendConfirmOpen(v)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('一键发送确认')}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-slate-600">
              {t('将向所有「已生成邮件、有邮箱且未发送过」的公司实际发送邮件，此操作会真实发出，确认继续？')}
            </p>
            <p className="text-sm text-slate-500">
              {t('发送内容与「邮件内容」里预览的版本一致（默认 {lang}，个别行手动切换过语言则以该行为准）', {
                lang: sendLang === 'en' ? 'English' : t('本地语言'),
              })}
            </p>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setSendConfirmOpen(false)} disabled={sendAllRunning}>
                {t('取消')}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setSendConfirmOpen(false);
                  void handleSendAll();
                }}
                disabled={sendAllRunning}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {sendAllRunning && <Loader2 className="animate-spin" size={14} />}
                {t('开始发送')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Batch progress bar */}
        {(batchAnalyzeOp.isRunning || batchGenerateOp.isRunning || batchWhatsAppOp.isRunning) && (
          <div className="mb-4">
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${activeBatchProgress}%` }}
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
                  p: activeBatchProcessed,
                  t: activeBatchTotal,
                  percent: activeBatchProgress,
                })}
              </span>
            </div>
          </div>
        )}

        {/* 勾选提示：批量按钮只作用于勾选项 */}
        {selectedIds.length > 0 && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <span>
              {t('已勾选 {n} 家，下方批量操作只对这些公司生效', { n: selectedIds.length })}
            </span>
            <button
              type="button"
              className="ml-auto text-blue-600 hover:underline"
              onClick={() => setSelectedIds([])}
            >
              {t('清除勾选')}
            </button>
          </div>
        )}

        {/* Table */}
        <Table<Company>
          columns={effectiveColumns}
          components={{
            header: {
              cell: ResizableHeaderCell as unknown as React.ComponentType<Record<string, unknown>>,
            },
          }}
          dataSource={listData?.items || []}
          loading={listLoading}
          rowKey="id"
          scroll={{ x: totalColWidth, y: 500 }}
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
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys as string[]),
            preserveSelectedRowKeys: true,
          }}
          // antd 自带文案不受 t() 管：TableLocale 只覆盖表格自身的（空状态、全选、排序提示），
          // 分页的"共 x 条 / 第 x 页"由 ConfigProvider 的 locale 负责（见 App.tsx）。
          locale={{
            emptyText: t('暂无数据'),
            selectAll: t('全选本页'),
            selectNone: t('取消选择'),
            selectInvert: t('反选'),
            sortTitle: t('点击排序'),
            expand: t('展开'),
            collapse: t('收起'),
            triggerAsc: t('升序'),
            triggerDesc: t('降序'),
          }}
        />
      </div>
    </div>
  );
};

export default WorkbenchTab;
