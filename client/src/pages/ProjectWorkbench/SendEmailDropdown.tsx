import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  Send,
  Mail,
  Copy,
  Download,
  MessageCircle,
  Phone,
  Loader2,
  ChevronDown,
} from 'lucide-react';

import * as emailGeneratorApi from '@client/src/api/email-generator';
import { Button } from '@client/src/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/src/components/ui/dropdown-menu';
import type { Company } from '@shared/api.interface';
import { useI18n } from '@client/src/i18n';
import {
  bestChatPhone,
  bestViberPhone,
  bestWhatsAppPhone,
  buildViberUrl,
  buildWhatsAppUrl,
  copyToClipboard,
  openExternal,
  toDigits,
  type ChatChannel,
} from '@client/src/utils/chat-links';

interface SendEmailDropdownProps {
  record: Company;
  onCopy: (text: string, label: string) => void;
  displayLang: 'local' | 'en';
}

const SendEmailDropdown: React.FC<SendEmailDropdownProps> = ({
  record,
  onCopy,
  displayLang,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const email = record.websiteContactEmail || record.email || '';
  const subject =
    displayLang === 'local' && record.emailSubjectLocal
      ? record.emailSubjectLocal
      : record.emailSubject || '';
  const body =
    displayLang === 'local' && record.emailBodyLocal
      ? record.emailBodyLocal
      : record.emailBody || '';

  const chatPhone = bestChatPhone(record);
  const hasPhone = !!chatPhone;

  // Lazily fetch the prepared IM script when the menu is opened.
  const { data: waInfo, isFetching: waLoading } = useQuery({
    queryKey: ['whatsapp-info', record.id],
    queryFn: () => emailGeneratorApi.getWhatsAppInfo(record.id),
    enabled: open && hasPhone,
    staleTime: 30_000,
  });

  const handleCopyEmail = () => {
    if (email) onCopy(email, t('邮箱'));
  };

  const handleCopySubject = () => {
    if (subject) onCopy(subject, t('邮件主题'));
  };

  const handleCopyBody = () => {
    if (body) onCopy(body, t('邮件正文'));
  };

  const handleDownloadEml = () => {
    const url = emailGeneratorApi.getEmlUrl(record.id);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleMailto = () => {
    if (!email) return;
    const params = new URLSearchParams();
    if (subject) params.set('subject', subject);
    if (body) params.set('body', body);
    location.assign(`mailto:${email}?${params.toString()}`);
  };

  /**
   * Open WhatsApp or Viber. Both channels are independently available.
   * WhatsApp prefills the script via wa.me; Viber opens viber.me (the script
   * is copied to the clipboard because viber.me cannot prefill text).
   *
   * IMPORTANT: window.open / openExternal must happen in the synchronous
   * click stack (before any await) to avoid popup blockers.
   */
  const handleOpenChat = (channel: ChatChannel) => {
    if (!chatPhone) {
      toast.error(t('该公司没有可用电话号码'));
      return;
    }
    const phone = channel === 'whatsapp'
      ? bestWhatsAppPhone(record) || chatPhone
      : bestViberPhone(record) || chatPhone;
    if (!phone) {
      toast.error(t('该公司没有可用电话号码'));
      return;
    }

    const digits = toDigits(phone);
    let message =
      displayLang === 'local'
        ? waInfo?.messageTextLocal || waInfo?.messageText || ''
        : waInfo?.messageText || waInfo?.messageTextLocal || '';
    // Fall back to any stored script on the record.
    if (!message) {
      message =
        displayLang === 'local'
          ? record.whatsappMessageLocal || record.whatsappMessage || ''
          : record.whatsappMessage || record.whatsappMessageLocal || '';
    }

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
        }
      });
    } else {
      toast.info(t('正在外部浏览器打开 {channel}', { channel: channelName }));
    }

    setOpen(false);
  };

  const hasEmailContent = !!(subject || body);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="sm">
          <Send size={14} />
          {t('发送邮件')}
          <ChevronDown size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {email && (
          <>
            <DropdownMenuLabel>{t('邮件操作')}</DropdownMenuLabel>
            <DropdownMenuItem onClick={handleMailto} className="gap-2">
              <Mail size={14} />
              {t('系统邮件客户端打开')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyEmail} className="gap-2">
              <Copy size={14} />
              {t('复制邮箱地址')}
            </DropdownMenuItem>
            {hasEmailContent && (
              <>
                <DropdownMenuItem onClick={handleCopySubject} className="gap-2">
                  <Copy size={14} />
                  {t('复制邮件主题')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyBody} className="gap-2">
                  <Copy size={14} />
                  {t('复制邮件正文')}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={handleDownloadEml} className="gap-2">
              <Download size={14} />
              {t('下载 .eml 文件')}
            </DropdownMenuItem>
          </>
        )}

        {hasPhone && (
          <>
            {email && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{t('即时消息')}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => handleOpenChat('whatsapp')}
              className="gap-2 text-green-600 focus:text-green-700 focus:bg-green-50"
            >
              {waLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <MessageCircle size={14} />
              )}
              {t('打开 WhatsApp')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleOpenChat('viber')}
              className="gap-2 text-purple-600 focus:text-purple-700 focus:bg-purple-50"
            >
              <Phone size={14} />
              {t('打开 Viber')}
            </DropdownMenuItem>
          </>
        )}

        {!email && !hasPhone && (
          <DropdownMenuItem disabled className="gap-2 opacity-50">
            <Mail size={14} />
            {t('无邮箱和手机号')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default SendEmailDropdown;
