import React from 'react';
import { AlertTriangle, Loader2, Copy, Mail } from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@client/src/components/ui/alert-dialog';
import type { Company } from '@shared/api.interface';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import { useI18n } from '@client/src/i18n';

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingFile: File | null;
  uploadMode: 'append' | 'overwrite';
  setUploadMode: (mode: 'append' | 'overwrite') => void;
  isUploading: boolean;
  onConfirm: () => void;
}

export const ImportDialog: React.FC<ImportDialogProps> = ({
  open,
  onOpenChange,
  pendingFile,
  uploadMode,
  setUploadMode,
  isUploading,
  onConfirm,
}) => {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('选择导入模式')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-slate-600">
            {t('文件名：')}
            <span className="font-medium text-slate-800">
              {pendingFile?.name}
            </span>
          </p>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">{t('导入模式')}</p>
            <div className="flex gap-3">
              <label className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="uploadMode"
                  value="append"
                  checked={uploadMode === 'append'}
                  onChange={() => setUploadMode('append')}
                  className="sr-only"
                />
                <div
                  className={`rounded-md border p-4 transition-colors ${
                    uploadMode === 'append'
                      ? 'border-primary bg-primary/5'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <p className="text-sm font-medium text-slate-800">{t('追加')}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t('在现有数据基础上追加新记录')}
                  </p>
                </div>
              </label>
              <label className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="uploadMode"
                  value="overwrite"
                  checked={uploadMode === 'overwrite'}
                  onChange={() => setUploadMode('overwrite')}
                  className="sr-only"
                />
                <div
                  className={`rounded-md border p-4 transition-colors ${
                    uploadMode === 'overwrite'
                      ? 'border-destructive bg-destructive/5'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <p className="text-sm font-medium text-slate-800">{t('覆盖')}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t('清空现有数据，导入新记录')}
                  </p>
                </div>
              </label>
            </div>
          </div>
          {uploadMode === 'overwrite' && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle
                size={16}
                className="text-amber-600 mt-0.5 flex-shrink-0"
              />
              <p className="text-xs text-amber-700">
                {t('覆盖模式将清空所有现有数据，此操作不可撤销，请确认后继续。')}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isUploading}
          >
            {t('取消')}
          </Button>
          <Button
            variant="default"
            onClick={onConfirm}
            disabled={isUploading}
          >
            {isUploading && <Loader2 className="animate-spin" size={16} />}
            {t('确认导入')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  onConfirm: () => void;
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  open,
  onOpenChange,
  companyName,
  onConfirm,
}) => {
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('确认删除')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('确定要删除「{name}」吗？此操作不可撤销。', { name: companyName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            {t('删除')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export interface EmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
  onCopy: (text: string, label: string) => void;
}

export const EmailDialog: React.FC<EmailDialogProps> = ({
  open,
  onOpenChange,
  company,
  onCopy,
}) => {
  const { t } = useI18n();
  const [dialogLang, setDialogLang] = React.useState<'local' | 'en'>('local');

  const hasLocalEmail = !!(company?.emailSubjectLocal || company?.emailBodyLocal);
  const activeLang: 'local' | 'en' = hasLocalEmail && dialogLang === 'local' ? 'local' : 'en';
  const subject =
    activeLang === 'local' ? company?.emailSubjectLocal || '' : company?.emailSubject || '';
  const body =
    activeLang === 'local' ? company?.emailBodyLocal || '' : company?.emailBody || '';

  const buildMailtoUrl = (): string => {
    if (!company) return '';
    const email = company.email || '';
    return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('发送邮件')}</DialogTitle>
        </DialogHeader>
        {company && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Language Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{t('语言：')}</span>
              <div className="inline-flex rounded-md overflow-hidden border border-slate-200">
                <button
                  type="button"
                  onClick={() => setDialogLang('local')}
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
                  onClick={() => setDialogLang('en')}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    activeLang === 'en'
                      ? 'bg-primary text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  English
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">{t('收件人')}</p>
              <p className="text-sm text-slate-800 break-all">
                {company.email || '-'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">{t('邮件主题')}</p>
              <p className="text-sm text-slate-800 font-medium">
                {subject || '-'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">{t('邮件正文')}</p>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 max-h-[240px] overflow-y-auto">
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {body || '-'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="default"
                asChild
                className="flex-1 min-w-[180px]"
              >
                <UniversalLink to={buildMailtoUrl()}>
                  <Mail size={16} />
                  {t('用默认邮件程序发送')}
                </UniversalLink>
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCopy(company.email || '', t('收件人'))}
              >
                <Copy size={14} />
                {t('复制收件人')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCopy(subject, t('主题'))}
              >
                <Copy size={14} />
                {t('复制主题')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCopy(body, t('正文'))}
              >
                <Copy size={14} />
                {t('复制正文')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onCopy(
                    `${subject}\n\n${body}`,
                    t('全文'),
                  )
                }
              >
                <Copy size={14} />
                {t('复制全文')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export interface BatchDeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  isDeleting: boolean;
  onConfirm: () => void;
}

export const BatchDeleteConfirmDialog: React.FC<BatchDeleteConfirmDialogProps> = ({
  open,
  onOpenChange,
  selectedCount,
  isDeleting,
  onConfirm,
}) => {
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('确认批量删除')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('确定要删除选中的 {n} 条重复记录吗？此操作不可撤销。', { n: selectedCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className="animate-spin" size={16} />}
            {t('删除')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
