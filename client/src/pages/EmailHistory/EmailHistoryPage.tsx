import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Inbox, Send, XCircle, RefreshCw } from 'lucide-react';
import { getEmailHistories, type EmailHistoryItem } from '@client/src/api/email-generator';
import { useI18n } from '@client/src/i18n';
import { Button } from '@client/src/components/ui/button';
import { EmailHistoryList } from '@client/src/components/EmailHistoryList';
import { Input } from '@client/src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Card, CardContent } from '@client/src/components/ui/card';
import { Skeleton } from '@client/src/components/ui/skeleton';

/**
 * 邮件往来历史（全局）：所有项目的发信 + 收信记录。
 * 收信由后台 IMAP 轮询自动入库（设置 → 发信服务里开启），这里只读展示。
 */
const EmailHistoryPage: React.FC = () => {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [direction, setDirection] = useState<'all' | 'outbound' | 'inbound'>('all');
  const [status, setStatus] = useState<'all' | 'sent' | 'failed' | 'received'>('all');
  // 按邮箱筛选：看哪个邮箱的往来
  const [mailbox, setMailbox] = useState('all');
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['email-history-global', appliedSearch, direction, status, mailbox, page],
    queryFn: () =>
      getEmailHistories({
        search: appliedSearch || undefined,
        direction: direction === 'all' ? undefined : direction,
        status: status === 'all' ? undefined : status,
        email: mailbox === 'all' ? undefined : mailbox,
        page,
        pageSize,
      }),
    staleTime: 15_000,
  });

  // 可选邮箱：汇总往来记录里出现过的地址（发件 + 收件）。
  // 只汇总当前页——要全量地址需要单独接口，这里先用页内数据，够日常筛选用。
  React.useEffect(() => {
    const addrs = new Set<string>();
    for (const it of data?.items ?? []) {
      if (it.fromAddr) addrs.add(it.fromAddr);
      if (it.toAddr) addrs.add(it.toAddr);
    }
    setMailboxes([...addrs].sort());
  }, [data]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-[260px]">
          <Input
            placeholder={t('搜索公司名 / 邮箱 / 主题')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setAppliedSearch(search);
                setPage(1);
              }
            }}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setAppliedSearch(search);
            setPage(1);
          }}
        >
          {t('搜索')}
        </Button>
        <Select
          value={direction}
          onValueChange={(v) => {
            setDirection(v as typeof direction);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('全部方向')}</SelectItem>
            <SelectItem value="outbound">{t('发信')}</SelectItem>
            <SelectItem value="inbound">{t('收信')}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as typeof status);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('全部状态')}</SelectItem>
            <SelectItem value="sent">{t('已发送')}</SelectItem>
            <SelectItem value="received">{t('已收到')}</SelectItem>
            <SelectItem value="bounce">{t('退信')}</SelectItem>
            <SelectItem value="failed">{t('失败')}</SelectItem>
          </SelectContent>
        </Select>
        {/* 按邮箱筛选：看某个邮箱的全部往来 */}
        <Select
          value={mailbox}
          onValueChange={(v) => {
            setMailbox(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder={t('全部邮箱')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('全部邮箱')}</SelectItem>
            {mailboxes.map((addr) => (
              <SelectItem key={addr} value={addr}>
                {addr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-slate-500">
          {t('共 {n} 条', { n: total })}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
              <Inbox size={36} />
              <p className="text-sm">{t('暂无往来记录')}</p>
              <p className="text-xs">{t('发送邮件或后台收到回复后，记录会自动出现在这里')}</p>
            </div>
          ) : (
            // 复用共享列表：每条可点开看完整正文（与公司行「往来记录」行为一致）
            <div className="p-3">
              <EmailHistoryList items={items} maxHeight="max-h-none" showCompany />
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t('上一页')}
          </Button>
          <span className="text-sm text-slate-600">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t('下一页')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default EmailHistoryPage;
