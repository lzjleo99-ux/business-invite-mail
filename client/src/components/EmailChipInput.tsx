import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@client/src/i18n';

/**
 * 收件人输入（CC/BCC 用的"标签"式）：输入一个邮箱后按回车 / 逗号 / 分号
 * 自动识别成一个标签；点标签上的 × 删除；退格删最后一个。
 * 值以逗号分隔字符串对外（与服务端 cc_addr/bcc_addr 一致）。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailChipInputProps {
  label: string;
  /** 逗号分隔的邮箱串 */
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

const EmailChipInput: React.FC<EmailChipInputProps> = ({
  label,
  value,
  onChange,
  placeholder,
}) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState('');

  const emails = value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const commit = (): void => {
    const raw = draft.trim();
    if (!raw) return;
    const parts = raw.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    const good: string[] = [];
    for (const p of parts) {
      if (!EMAIL_RE.test(p)) {
        setInvalid(p);
        continue;
      }
      if (!emails.includes(p)) good.push(p);
    }
    if (good.length > 0) onChange([...emails, ...good].join(', '));
    setDraft('');
    if (parts.length === good.length) setInvalid('');
  };

  const remove = (email: string): void => {
    onChange(emails.filter((e) => e !== email).join(', '));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === 'Backspace' && draft === '' && emails.length > 0) {
      e.preventDefault();
      onChange(emails.slice(0, -1).join(', '));
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <div
        className={`flex flex-wrap items-center gap-1 rounded-md border bg-white px-2 py-1.5 ${
          invalid ? 'border-red-300' : 'border-slate-200'
        }`}
      >
        {emails.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
          >
            {email}
            <button
              type="button"
              className="text-slate-400 hover:text-red-500"
              onClick={() => remove(email)}
              title={t('删除')}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (invalid) setInvalid('');
          }}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder={emails.length === 0 ? placeholder : ''}
          className="min-w-[160px] flex-1 border-0 bg-transparent text-sm outline-none"
        />
      </div>
      {invalid && (
        <p className="text-xs text-red-500">
          {t('{email} 不是有效邮箱地址', { email: invalid })}
        </p>
      )}
    </div>
  );
};

export default EmailChipInput;
