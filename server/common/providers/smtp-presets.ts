/**
 * 发信服务商预设（SMTP provider presets）
 *
 * 背景：这是一套 B2B 冷开发信系统，主流"免费"发信服务（SendGrid/Mailgun/
 * Postmark/Brevo）条款都禁止 unsolicited email，Amazon SES 虽技术上可用但
 * 冷邮件投诉率 >0.1% 会封号。因此不做"绑定单一服务"的集成，而是提供
 * SMTP 预设让用户可以即插即用任何服务（包括专做冷邮件的 Maildoso 等）。
 *
 * 本文件是**静态配置数据**，不含密钥，不落库。
 */

export interface SmtpProviderPreset {
  id: string;
  name: string;
  nameEn: string;
  /** SMTP 服务器 */
  host: string;
  port: number;
  secure: boolean;
  /** IMAP（收退信用；没有则 null） */
  imapHost: string | null;
  imapPort: number;
  /** 密码类型说明（授权码 / IAM SMTP 凭证 / API key） */
  credentialHint: string;
  credentialHintEn: string;
  /** 该服务对 B2B 冷邮件的友好度提示 */
  coldEmailNote: string;
  coldEmailNoteEn: string;
  /** 冷邮件友好度：good | restricted | prohibited */
  coldEmailPolicy: 'good' | 'restricted' | 'prohibited';
  /** 官方文档链接 */
  docsUrl: string;
}

export const SMTP_PROVIDER_PRESETS: SmtpProviderPreset[] = [
  {
    id: 'tencent-exmail',
    name: '腾讯企业邮箱',
    nameEn: 'Tencent Exmail',
    host: 'smtp.exmail.qq.com',
    port: 465,
    secure: true,
    imapHost: 'imap.exmail.qq.com',
    imapPort: 993,
    credentialHint: '使用邮箱授权码（不是登录密码）',
    credentialHintEn: 'Use app password (not login password)',
    coldEmailNote: '对营销内容审核严格，550 inappropriate content 即被内容指纹拦截',
    coldEmailNoteEn: 'Strict content filter; 550 inappropriate content means content fingerprint block',
    coldEmailPolicy: 'restricted',
    docsUrl: 'https://open.work.weixin.qq.com/help2/pc/19817',
  },
  {
    id: 'amazon-ses',
    name: 'Amazon SES',
    nameEn: 'Amazon SES',
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    secure: false, // SES SMTP: 587 STARTTLS（secure=false 让 nodemailer 走 STARTTLS）
    imapHost: null,
    imapPort: 993,
    credentialHint: '在 SES 控制台创建 SMTP 凭证（IAM 用户的 SMTP 用户名/密码），区域需与 host 一致',
    credentialHintEn: 'Create SMTP credentials in SES console; region must match host',
    coldEmailNote: '条款限制 unsolicited 邮件，投诉率>0.1%会封号；适合小批量合规 B2B 测试',
    coldEmailNoteEn: 'Restricted for unsolicited mail; >0.1% complaint rate triggers suspension',
    coldEmailPolicy: 'restricted',
    docsUrl: 'https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html',
  },
  {
    id: 'maildoso',
    name: 'Maildoso（冷邮件专用）',
    nameEn: 'Maildoso (cold email)',
    host: 'smtp.maildoso.com', // 以服务商实际提供的为准，用户可改
    port: 587,
    secure: false,
    imapHost: 'imap.maildoso.com',
    imapPort: 993,
    credentialHint: '在 Maildoso 平台创建 SMTP 邮箱后获取（host 以平台显示为准）',
    credentialHintEn: 'Create SMTP mailbox in Maildoso dashboard; use host shown there',
    coldEmailNote: '专为 B2B 冷邮件设计，IP 轮换+自愈，单邮箱 15 封/天；付费服务',
    coldEmailNoteEn: 'Built for B2B cold email: IP rotation, self-healing, 15/day per mailbox; paid',
    coldEmailPolicy: 'good',
    docsUrl: 'https://maildoso.com/',
  },
  {
    id: 'custom',
    name: '自定义 SMTP',
    nameEn: 'Custom SMTP',
    host: '',
    port: 465,
    secure: true,
    imapHost: null,
    imapPort: 993,
    credentialHint: '填入服务商提供的 SMTP 服务器、端口、账号密码',
    credentialHintEn: 'Enter SMTP host, port, credentials from your provider',
    coldEmailNote: '请自行确认服务商条款是否允许冷邮件',
    coldEmailNoteEn: 'Check your provider terms on unsolicited email',
    coldEmailPolicy: 'restricted',
    docsUrl: '',
  },
];

/** 根据错误文本分类发信失败原因（给用户可操作的提示） */
export function classifySendError(message: string): {
  category: 'content_filter' | 'auth' | 'rate_limit' | 'network' | 'recipient' | 'unknown';
  hint: string;
  hintEn: string;
} {
  const m = (message || '').toLowerCase();
  if (/inappropriate words|content denied|content filter|550 [\s\S]*content/.test(m)) {
    return {
      category: 'content_filter',
      hint: '服务商内容审核拦截（不是配置问题）。该服务商可能不允许营销/群发内容。建议换用冷邮件专用服务商，或联系服务商申诉。反复重发同样内容会加重拦截。',
      hintEn: 'Provider content filter (not a config issue). Consider a cold-email-friendly provider or appeal. Repeated identical sends worsen the block.',
    };
  }
  if (/535|authentication failed|invalid login|bad credentials|系统繁忙/.test(m)) {
    return {
      category: 'auth',
      hint: 'SMTP 认证失败：检查邮箱/授权码是否正确（授权码不是登录密码），或联系服务商。',
      hintEn: 'SMTP auth failed: verify credentials (use app password, not login password).',
    };
  }
  if (/frequency|rate limit|too many|connection denied|450|421/.test(m)) {
    return {
      category: 'rate_limit',
      hint: '触发发送频率限制：降低 sending 频率（增大每封间隔），稍后重试。',
      hintEn: 'Rate limited: increase delay between sends and retry later.',
    };
  }
  if (/enotfound|econnrefused|etimedout|network|socket|tls/.test(m)) {
    return {
      category: 'network',
      hint: '网络连接错误：检查 SMTP 服务器地址和端口是否正确，或稍后重试。',
      hintEn: 'Network error: check SMTP host/port, or retry later.',
    };
  }
  if (/550.*(user unknown|mailbox not found|no such user)|recipient/.test(m)) {
    return {
      category: 'recipient',
      hint: '收件人不存在或拒收：该邮箱可能无效，建议从名录中移除。',
      hintEn: 'Recipient rejected: address may be invalid; remove from list.',
    };
  }
  return { category: 'unknown', hint: '', hintEn: '' };
}
