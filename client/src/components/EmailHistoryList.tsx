import React from 'react';
import { Mail, MailCheck, Send, XCircle, Inbox } from 'lucide-react';
import type { EmailHistoryItem } from '@client/src/api/email-generator';
import { useI18n } from '@client/src/i18n';

interface Props {
  items: EmailHistoryItem[];
  emptyText?: string;
  maxHeight?: string;
  showCompany?: boolean;
}

/** 邮件往来记录列表（公司行展开面板 / 往来历史页共用） */
export const EmailHistoryList: React.FC<Props> = ({
  items,
  emptyText,
  maxHeight = 'max-h-64',
  showCompany = false,
}) => {
  const { t } = useI18n();
  if (items.length === 0) {
    return (
      <p className="text-xs text-slate-400 py-2">
        {emptyText ?? t('暂无往来记录')}
      </p>
    );
  }
  return (
    <ul className={`space-y-2 overflow-auto ${maxHeight} pr-1`}>
      {items.map((h) => {
        const inbound = h.direction === 'inbound';
        const failed = h.status === 'failed';
        return (
          <li
            key={h.id}
            className="rounded-md border border-slate-200 bg-white p-2.5 text-xs space-y-1"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                  inbound
                    ? 'bg-emerald-50 text-emerald-700'
                    : failed
                      ? 'bg-red-50 text-red-700'
                      : 'bg-blue-50 text-blue-700'
                }`}
              >
                {inbound ? <Inbox size={11} /> : failed ? <XCircle size={11} /> : <Send size={11} />}
                {inbound ? t('收到回复') : failed ? t('发送失败') : t('已发送')}
              </span>
              <span className="text-slate-500">
                {new Date(h.at).toLocaleString('zh-CN', { hour12: false })}
              </span>
              {showCompany && h.companyName && (
                <span className="text-slate-600 font-medium">{h.companyName}</span>
              )}
            </div>
            <p className="font-medium text-slate-800 break-all">
              {h.subject || t('（无主题）')}
            </p>
            <p className="text-slate-500 break-all">
              {inbound ? `${h.fromAddr} → ${h.toAddr}` : `${h.fromAddr} → ${h.toAddr}`}
            </p>
            {h.snippet && (
              <p className="text-slate-600 line-clamp-2 break-all">{h.snippet}</p>
            )}
            {failed && h.error && (
              <p className="text-red-600 break-all">{h.error}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default EmailHistoryList;
