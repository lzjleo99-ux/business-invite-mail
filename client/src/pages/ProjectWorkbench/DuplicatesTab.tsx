import React from 'react';
import {
  Search,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Checkbox } from '@client/src/components/ui/checkbox';
import type {
  Company,
  CompanyStatus,
  DuplicateCheckResponse,
  DuplicateGroup,
} from '@shared/api.interface';
import { useI18n } from '@client/src/i18n';

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

export interface DuplicatesTabProps {
  duplicates: DuplicateCheckResponse | undefined;
  dupLoading: boolean;
  checkingDuplicates: boolean;
  selectedDupIds: Set<string>;
  onCheckDuplicates: () => void;
  onToggleDup: (companyId: string, checked: boolean) => void;
  onToggleGroup: (group: DuplicateGroup, checked: boolean) => void;
  onKeepFirst: (group: DuplicateGroup) => void;
  onGroupDelete: (group: DuplicateGroup) => void;
  onGlobalBatchDelete: () => void;
  isGroupAllSelected: (group: DuplicateGroup) => boolean;
}

const DuplicatesTab: React.FC<DuplicatesTabProps> = ({
  duplicates,
  dupLoading,
  checkingDuplicates,
  selectedDupIds,
  onCheckDuplicates,
  onToggleDup,
  onToggleGroup,
  onKeepFirst,
  onGroupDelete,
  onGlobalBatchDelete,
  isGroupAllSelected,
}) => {
  const { t } = useI18n();

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

  const matchFieldLabel = (f: 'name' | 'email' | 'website'): string =>
    ({ name: t('名称'), email: t('邮箱'), website: t('网站') })[f];

  const formatMatchFields = (fields: ('name' | 'email' | 'website')[]): string =>
    fields.map(matchFieldLabel).join(', ');

  const hasResults = duplicates && duplicates.groups.length > 0;
  const noResults = duplicates && duplicates.groups.length === 0;
  const notChecked = !duplicates && !checkingDuplicates && !dupLoading;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">
              {t('重复数据检测')}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {t('按名称、邮箱、网站检测疑似重复的公司记录')}
            </p>
          </div>
          <Button
            variant="default"
            onClick={onCheckDuplicates}
            disabled={checkingDuplicates}
          >
            {checkingDuplicates ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Search size={16} />
            )}
            {t('开始查重')}
          </Button>
        </div>

        {hasResults && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="text-sm text-slate-500">
                {t('共发现 {groups} 组疑似重复，涉及 {total} 条记录', {
                  groups: duplicates.groups.length,
                  total: duplicates.totalDuplicates,
                })}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    for (const g of duplicates.groups) {
                      onKeepFirst(g);
                    }
                  }}
                >
                  {t('全部保留每组第一条')}
                </Button>
              </div>
            </div>
            <div className="space-y-4">
              {duplicates.groups.map((group) => (
                <div
                  key={group.groupKey}
                  className="rounded-md border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {t('匹配：{fields}', { fields: formatMatchFields(group.matchFields) })}
                      </Badge>
                      <span className="text-sm font-medium text-slate-700">
                        {group.groupKey}
                      </span>
                      <span className="text-xs text-slate-400">
                        {t('共 {n} 条', { n: group.companies.length })}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onKeepFirst(group)}
                      >
                        {t('保留第一条')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => onGroupDelete(group)}
                      >
                        <Trash2 size={14} />
                        {t('删除选中')}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-2 py-1">
                      <Checkbox
                        checked={isGroupAllSelected(group)}
                        onCheckedChange={(checked) =>
                          onToggleGroup(group, !!checked)
                        }
                      />
                      <span className="text-xs text-slate-500">
                        {t('全选本组')}
                      </span>
                    </div>
                    {group.companies.map((company: Company) => (
                      <div
                        key={company.id}
                        className="flex items-center gap-3 rounded bg-white p-3 border border-slate-200"
                      >
                        <Checkbox
                          checked={selectedDupIds.has(company.id)}
                          onCheckedChange={(checked) =>
                            onToggleDup(company.id, !!checked)
                          }
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">
                            {company.name}
                          </p>
                          <p className="text-xs text-slate-400 truncate">
                            {company.email || '-'} ·{' '}
                            {company.website || '-'}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className={getStatusBadgeStyle(company.status)}
                        >
                          {statusLabel(company.status)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {selectedDupIds.size > 0 && (
              <div className="sticky bottom-0 flex items-center justify-between bg-white border-t border-slate-200 pt-4 -mx-5 px-5 -mb-5 pb-5 z-10">
                <div className="text-sm text-slate-600">
                  {t('已选择删除 {n} 条重复数据', { n: selectedDupIds.size })}
                </div>
                <Button
                  variant="default"
                  className="bg-red-600 hover:bg-red-700"
                  onClick={onGlobalBatchDelete}
                >
                  <Trash2 size={16} />
                  {t('删除所有选中')}
                </Button>
              </div>
            )}
          </>
        )}

        {noResults && (
          <div className="text-center py-12">
            <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
            <p className="text-sm text-slate-600 font-medium">{t('未发现重复')}</p>
            <p className="text-xs text-slate-400 mt-1">
              {t('当前项目中所有公司记录均为唯一')}
            </p>
          </div>
        )}

        {notChecked && (
          <div className="text-center py-12">
            <XCircle size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">
              {t('点击"开始查重"按钮检测重复数据')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DuplicatesTab;
