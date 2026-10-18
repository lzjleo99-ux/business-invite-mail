import React, { useState } from 'react';
import { Mail, MailCheck, Send, XCircle, Inbox, ChevronDown, AlertTriangle } from 'lucide-react';
import type {
  EmailHistoryItem,
  EmailHistoryDetail,
} from '@client/src/api/email-generator';
import { getEmailHistoryDetail } from '@client/src/api/email-generator';
import { useI18n } from '@client/src/i18n';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';

interface Props {
  items: EmailHistoryItem[];
  emptyText?: string;
  maxHeight?: string;
  showCompany?: boolean;
}

/** 邮件往来记录列表（公司行展开面板 / 往来历史页共用）——每条可点开看完整正文 */
export const EmailHistoryList: React.FC<Props> = ({
  items,
  emptyText,
  maxHeight = 'max-h-64',
  showCompany = false,
}) => {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);

  // 详情按需拉取：列表只带 140 字摘要，正文最多 2 万字，不能一次性全塞回来
  const { data: detail } = useQuery({
    queryKey: ['email-history-detail', openId],
    queryFn: () => getEmailHistoryDetail(openId as string),
    enabled: !!openId,
    staleTime: 60_000,
  });

  if (items.length === 0) {
    return (
      <p className="text-xs text-slate-400 py-2">
        {emptyText ?? t('暂无往来记录')}
      </p>
    );
  }
  return (
    <>
      <ul className={`space-y-2 overflow-auto ${maxHeight} pr-1`}>
      {items.map((h) => {
        const bounce = h.status === 'bounce';
        const inbound = h.direction === 'inbound' && !bounce;
        const failed = h.status === 'failed';
        const label = bounce ? t('退信') : inbound ? t('收到回复') : failed ? t('发送失败') : t('已发送');
        return (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => setOpenId(h.id)}
              className="w-full cursor-pointer rounded-md border border-slate-200 bg-white p-2.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                    bounce
                      ? 'bg-orange-50 text-orange-700'
                      : inbound
                        ? 'bg-emerald-50 text-emerald-700'
                        : failed
                          ? 'bg-red-50 text-red-700'
                          : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  {bounce ? (
                    <AlertTriangle size={11} />
                  ) : inbound ? (
                    <Inbox size={11} />
                  ) : failed ? (
                    <XCircle size={11} />
                  ) : (
                    <Send size={11} />
                  )}
                  {label}
                </span>
                  <span className="text-slate-500">
                    {new Date(h.at).toLocaleString('zh-CN', { hour12: false })}
                  </span>
                  {showCompany && h.companyName && (
                    <span className="text-slate-600 font-medium">{h.companyName}</span>
                  )}
                  <ChevronDown size={12} className="ml-auto shrink-0 text-slate-400" />
                </div>
                <p className="font-medium text-slate-800 break-all">
                  {h.subject || t('（无主题）')}
                </p>
                <p className="text-slate-500 break-all">
                  {`${h.fromAddr} → ${h.toAddr}`}
                </p>
                {h.snippet && (
                  <p className="text-slate-600 line-clamp-2 break-all">{h.snippet}</p>
                )}
                {failed && h.error && (
                  <p className="text-red-600 break-all">{h.error}</p>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog open={!!openId} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detail ? detail.subject || t('（无主题）') : t('加载中...')}
            </DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-3 text-sm">
              <div className="space-y-1 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                <p>
                  <span className="font-medium text-slate-700">{t('类型')}：</span>
                  {detail.status === 'bounce'
                    ? t('退信')
                    : detail.direction === 'inbound'
                      ? t('收到回复')
                      : detail.status === 'failed'
                        ? t('发送失败')
                        : t('已发送')}
                </p>
                <p>
                  <span className="font-medium text-slate-700">{t('时间')}：</span>
                  {new Date(detail.at).toLocaleString('zh-CN', { hour12: false })}
                </p>
                <p className="break-all">
                  <span className="font-medium text-slate-700">{t('发件人')}：</span>
                  {detail.fromAddr}
                </p>
                <p className="break-all">
                  <span className="font-medium text-slate-700">{t('收件人')}：</span>
                  {detail.toAddr}
                </p>
                {detail.companyName && (
                  <p className="break-all">
                    <span className="font-medium text-slate-700">{t('公司')}：</span>
                    {detail.companyName}
                  </p>
                )}
                {detail.messageId && (
                  <p className="break-all text-slate-400">
                    <span className="font-medium text-slate-500">Message-ID：</span>
                    {detail.messageId}
                  </p>
                )}
              </div>
              {detail.error && (
                <p className="rounded-md bg-red-50 p-2 text-xs text-red-700 break-all">
                  {detail.error}
                </p>
              )}
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">{t('正文')}</p>
                <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700">
                  {(detail.bodyText || '').trim() || t('（无正文）')}
                </pre>
              </div>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">{t('加载中...')}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default EmailHistoryList;
