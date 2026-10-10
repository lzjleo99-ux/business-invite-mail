import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Home, ChevronRight } from 'lucide-react';

import * as restaurantsApi from '@client/src/api/restaurants';
import * as websiteAnalyzerApi from '@client/src/api/website-analyzer';
import * as emailGeneratorApi from '@client/src/api/email-generator';
import * as projectsApi from '@client/src/api/projects';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@client/src/components/ui/tabs';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@client/src/components/ui/breadcrumb';
import type {
  Company,
  CompanyStatus,
  StatsFilterKey,
  DuplicateGroup,
} from '@shared/api.interface';
import { useI18n } from '@client/src/i18n';

import WorkbenchTab from './WorkbenchTab';
import ProjectInfoTab from './ProjectInfoTab';
import DuplicatesTab from './DuplicatesTab';
import {
  ImportDialog,
  DeleteConfirmDialog,
  EmailDialog,
  BatchDeleteConfirmDialog,
} from './ProjectWorkbenchDialogs';

const queryClient = new QueryClient();

type StatusFilterValue = CompanyStatus | 'all';

const ProjectWorkbenchInner: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState('workbench');

  // Filter state
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [noEmailFilter, setNoEmailFilter] = useState(false);
  const [filterKey, setFilterKey] = useState<StatsFilterKey>('all');
  const [searchText, setSearchText] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Upload dialog state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<'append' | 'overwrite'>('append');
  const [isUploading, setIsUploading] = useState(false);

  // Delete confirm state
  const [deletingCompany, setDeletingCompany] = useState<Company | null>(null);

  // Email dialog state
  const [emailDialogCompany, setEmailDialogCompany] = useState<Company | null>(null);

  // Email edit in expanded row
  const [editingEmail, setEditingEmail] = useState<{
    subject: string;
    body: string;
    subjectLocal: string;
    bodyLocal: string;
  } | null>(null);
  const [editingEmailLanguage, setEditingEmailLanguage] = useState<'local' | 'en'>('local');
  const [savingEmailId, setSavingEmailId] = useState<string | null>(null);

  // Single action loading
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatingWhatsAppId, setGeneratingWhatsAppId] = useState<string | null>(null);

  // Project detail
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.getProject(id),
    enabled: !!id,
  });

  // Project edit state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSavingProject, setIsSavingProject] = useState(false);

  // Material upload
  const [isUploadingMaterial, setIsUploadingMaterial] = useState(false);

  // Duplicates
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [selectedDupIds, setSelectedDupIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  // Queries
  const { data: stats } = useQuery({
    queryKey: ['company-stats', id],
    queryFn: () => restaurantsApi.getCompanyStats(id),
    enabled: !!id,
  });

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['companies', id, page, pageSize, statusFilter, noEmailFilter, filterKey, searchText],
    queryFn: () =>
      restaurantsApi.getCompanies({
        projectId: id,
        page,
        pageSize,
        status: statusFilter === 'all' ? undefined : statusFilter,
        noEmail: noEmailFilter || undefined,
        filterKey: filterKey === 'all' ? undefined : filterKey,
        search: searchText || undefined,
      }),
    enabled: !!id,
  });

  const { data: duplicates, refetch: refetchDuplicates, isFetching: dupLoading } = useQuery({
    queryKey: ['duplicates', id],
    queryFn: () => restaurantsApi.getDuplicates(id),
    enabled: false,
  });

  const refreshAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['company-stats', id] });
    void qc.invalidateQueries({ queryKey: ['companies', id] });
    void qc.invalidateQueries({ queryKey: ['project', id] });
  }, [qc, id]);

  const refreshRow = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['companies', id], refetchType: 'all' });
    void qc.invalidateQueries({ queryKey: ['company-stats', id] });
  }, [qc, id]);

  const updateRowLocally = useCallback(
    (companyId: string, patch: Partial<Company>) => {
      void qc.setQueryData(
        ['companies', id, page, pageSize, statusFilter, noEmailFilter, filterKey, searchText],
        (old: typeof listData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item: Company) =>
              item.id === companyId ? { ...item, ...patch } : item,
            ),
          };
        },
      );
    },
    [qc, id, page, pageSize, statusFilter, noEmailFilter, filterKey, searchText],
  );

  const handleToggleStar = async (record: Company) => {
    const nextStarred = !record.isStarred;
    // Optimistic update
    updateRowLocally(record.id, { isStarred: nextStarred });
    try {
      const updated = await restaurantsApi.toggleStar(record.id, nextStarred);
      updateRowLocally(record.id, { isStarred: updated.isStarred });
      void qc.invalidateQueries({ queryKey: ['company-stats', id] });
    } catch (err: unknown) {
      // Revert on failure
      updateRowLocally(record.id, { isStarred: record.isStarred });
      logger.error('切换星标失败', err);
      toast.error(t('切换星标失败，请稍后重试'));
    }
  };

  const handleUpdateContactStatus = async (
    record: Company,
    type: 'whatsapp' | 'viber' | 'email',
    contacted: boolean,
  ) => {
    try {
      const updated = await restaurantsApi.updateContactStatus(record.id, type, contacted);
      updateRowLocally(record.id, { contactStatus: updated.contactStatus });
      toast.success(contacted ? t('已标记联系') : t('已取消联系标记'));
    } catch (err: unknown) {
      logger.error('更新联系状态失败', err);
      toast.error(t('更新联系状态失败，请稍后重试'));
    }
  };

  // --- Upload handlers ---
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error(t('请上传 .xlsx 格式的 Excel 文件'));
      return;
    }
    setPendingFile(file);
    setUploadMode('append');
    setUploadOpen(true);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error(t('请上传 .xlsx 格式的 Excel 文件'));
      return;
    }
    setPendingFile(file);
    setUploadMode('append');
    setUploadOpen(true);
  };

  const confirmUpload = async () => {
    if (!pendingFile) return;
    setIsUploading(true);
    try {
      const result = await restaurantsApi.importExcel(id, pendingFile, uploadMode);
      toast.success(
        t(
          '导入成功：共 {total} 条，成功 {success} 条，缺网站 {missingWebsite} 条，缺邮箱 {missingEmail} 条，缺电话 {missingPhone} 条',
          {
            total: result.total,
            success: result.success,
            missingWebsite: result.missingWebsite,
            missingEmail: result.missingEmail,
            missingPhone: result.missingPhone,
          },
        ),
      );
      setUploadOpen(false);
      setPendingFile(null);
      refreshAll();
      setPage(1);
    } catch (err: unknown) {
      logger.error('导入失败', err);
      const axiosErr = err as { response?: { data?: { error?: { message?: string; details?: string } } }; message?: string };
      let detail = axiosErr.response?.data?.error?.message || axiosErr.message || '';
      if (axiosErr.response?.data?.error?.details) {
        try {
          const parsed = JSON.parse(axiosErr.response.data.error.details);
          if (parsed?.message) detail = parsed.message;
        } catch {
          // not JSON, keep original
        }
      }
      toast.error(detail && detail !== '导入失败' ? t('导入失败：{detail}', { detail }) : t('导入失败，请稍后重试'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // --- Search / filter ---
  const handleSearch = () => {
    setSearchText(searchInput.trim());
    setFilterKey('all');
    setPage(1);
  };

  const handleStatusChange = (val: StatusFilterValue) => {
    setStatusFilter(val);
    setNoEmailFilter(false);
    setFilterKey('all');
    setPage(1);
  };

  const handleStatClick = (statKey: StatsFilterKey) => {
    setFilterKey(statKey);
    // Keep status/noEmail filter for backward compat with the status select
    if (statKey === 'all') {
      setStatusFilter('all');
      setNoEmailFilter(false);
    } else if (statKey === 'no_email') {
      setNoEmailFilter(true);
      setStatusFilter('all');
    } else if (statKey === 'starred') {
      setStatusFilter('all');
      setNoEmailFilter(false);
    } else if (statKey === 'analyzed' || statKey === 'pending' || statKey === 'generated' || statKey === 'failed') {
      setStatusFilter(statKey as StatusFilterValue);
      setNoEmailFilter(false);
    }
    setPage(1);
  };

  // --- Single actions ---
  const handleAnalyze = async (record: Company) => {
    setAnalyzingId(record.id);
    try {
      await websiteAnalyzerApi.analyzeCompany(record.id);
      toast.success(t('已开始分析网站，请稍后刷新查看结果'));
      refreshRow();
    } catch (err: unknown) {
      logger.error('分析失败', err);
      toast.error(t('分析失败，请稍后重试'));
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleGenerate = async (record: Company) => {
    setGeneratingId(record.id);
    try {
      const result = await emailGeneratorApi.generateEmail(record.id);
      toast.success(t('邮件生成成功'));
      void qc.setQueryData(
        ['companies', id, page, pageSize, statusFilter, noEmailFilter, filterKey, searchText],
        (old: typeof listData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item: Company) =>
              item.id === record.id
                ? {
                    ...item,
                    status: 'generated' as CompanyStatus,
                    emailSubject: result.subject,
                    emailBody: result.body,
                    emailSubjectLocal: result.subjectLocal,
                    emailBodyLocal: result.bodyLocal,
                    emailLanguage: result.languageCode,
                    websiteSummary: result.summary,
                  }
                : item,
            ),
          };
        },
      );
      void qc.invalidateQueries({ queryKey: ['company-stats', id] });
    } catch (err: unknown) {
      logger.error('生成邮件失败', err);
      toast.error(t('生成邮件失败，请稍后重试'));
    } finally {
      setGeneratingId(null);
    }
  };

  const handleDelete = async (record: Company) => {
    try {
      await restaurantsApi.deleteCompany(record.id);
      toast.success(t('删除成功'));
      setDeletingCompany(null);
      refreshAll();
    } catch (err: unknown) {
      logger.error('删除失败', err);
      toast.error(t('删除失败，请稍后重试'));
    }
  };

  // --- Batch actions moved to WorkbenchTab via useBatchOperation hook ---

  const handleGenerateWhatsApp = async (record: Company) => {
    setGeneratingWhatsAppId(record.id);
    try {
      const result = await emailGeneratorApi.generateWhatsApp(record.id);
      toast.success(t('WhatsApp 话术生成成功'));
      void qc.setQueryData(
        ['companies', id, page, pageSize, statusFilter, noEmailFilter, filterKey, searchText],
        (old: typeof listData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item: Company) =>
              item.id === record.id
                ? {
                    ...item,
                    whatsappPhone: result.internationalPhone,
                    whatsappMessage: result.messageText,
                    whatsappMessageLocal: result.messageTextLocal,
                  }
                : item,
            ),
          };
        },
      );
    } catch (err: unknown) {
      logger.error('生成WhatsApp话术失败', err);
      toast.error(t('生成失败，请稍后重试'));
    } finally {
      setGeneratingWhatsAppId(null);
    }
  };

  // --- Email edit & save ---
  const saveEmailEdit = async (record: Company) => {
    if (!editingEmail) return;
    setSavingEmailId(record.id);
    try {
      await restaurantsApi.updateEmail(record.id, {
        subject: editingEmail.subject,
        body: editingEmail.body,
      });
      toast.success(t('邮件内容已保存'));
      setEditingEmail(null);
      refreshRow();
    } catch (err: unknown) {
      logger.error('保存邮件失败', err);
      toast.error(t('保存失败，请稍后重试'));
    } finally {
      setSavingEmailId(null);
    }
  };

  const regenerateEmail = async (record: Company) => {
    setGeneratingId(record.id);
    try {
      const result = await emailGeneratorApi.generateEmail(record.id);
      toast.success(t('邮件已重新生成'));
      void qc.setQueryData(
        ['companies', id, page, pageSize, statusFilter, noEmailFilter, filterKey, searchText],
        (old: typeof listData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item: Company) =>
              item.id === record.id
                ? {
                    ...item,
                    status: 'generated' as CompanyStatus,
                    emailSubject: result.subject,
                    emailBody: result.body,
                    emailSubjectLocal: result.subjectLocal,
                    emailBodyLocal: result.bodyLocal,
                    emailLanguage: result.languageCode,
                    websiteSummary: result.summary,
                  }
                : item,
            ),
          };
        },
      );
      setEditingEmail({
        subject: result.subject,
        body: result.body,
        subjectLocal: result.subjectLocal || '',
        bodyLocal: result.bodyLocal || '',
      });
      void qc.invalidateQueries({ queryKey: ['company-stats', id] });
    } catch (err: unknown) {
      logger.error('重新生成失败', err);
      toast.error(t('重新生成失败，请稍后重试'));
    } finally {
      setGeneratingId(null);
    }
  };

  // --- Email dialog helpers ---
  const openEmailDialog = (record: Company) => {
    setEmailDialogCompany(record);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('{label}已复制', { label }));
    } catch (err: unknown) {
      logger.error('复制失败', err);
      toast.error(t('复制失败'));
    }
  };

  // --- Project save ---
  const handleStartEditProject = useCallback(() => {
    if (project) {
      setEditName(project.name);
      setEditDescription(project.description);
    }
  }, [project]);

  const handleSaveProject = async () => {
    setIsSavingProject(true);
    try {
      await projectsApi.updateProject(id, {
        name: editName,
        description: editDescription,
      });
      toast.success(t('项目资料已保存'));
      void qc.invalidateQueries({ queryKey: ['project', id] });
    } catch (err: unknown) {
      logger.error('保存项目失败', err);
      toast.error(t('保存失败，请稍后重试'));
    } finally {
      setIsSavingProject(false);
    }
  };

  // --- Material upload ---
  const handleUploadMaterial = async (file: File) => {
    setIsUploadingMaterial(true);
    try {
      await projectsApi.uploadMaterial(id, file);
      toast.success(t('文件上传成功'));
      void qc.invalidateQueries({ queryKey: ['project', id] });
    } catch (err: unknown) {
      logger.error('上传素材失败', err);
      toast.error(t('上传失败，请稍后重试'));
    } finally {
      setIsUploadingMaterial(false);
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    try {
      await projectsApi.deleteMaterial(id, materialId);
      toast.success(t('已删除文件'));
      void qc.invalidateQueries({ queryKey: ['project', id] });
    } catch (err: unknown) {
      logger.error('删除素材失败', err);
      toast.error(t('删除失败，请稍后重试'));
    }
  };

  // --- Duplicates ---
  const handleCheckDuplicates = async () => {
    setCheckingDuplicates(true);
    try {
      await refetchDuplicates();
    } catch (err: unknown) {
      logger.error('查重失败', err);
      toast.error(t('查重失败，请稍后重试'));
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const toggleDupSelection = (companyId: string, checked: boolean) => {
    setSelectedDupIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(companyId);
      else next.delete(companyId);
      return next;
    });
  };

  const toggleGroupSelection = (group: DuplicateGroup, checked: boolean) => {
    setSelectedDupIds((prev) => {
      const next = new Set(prev);
      for (const c of group.companies) {
        if (checked) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  };

  const keepFirstInGroup = (group: DuplicateGroup) => {
    setSelectedDupIds((prev) => {
      const next = new Set(prev);
      for (let i = 1; i < group.companies.length; i++) {
        next.add(group.companies[i].id);
      }
      if (group.companies.length > 0) {
        next.delete(group.companies[0].id);
      }
      return next;
    });
  };

  const isGroupAllSelected = (group: DuplicateGroup): boolean => {
    return group.companies.every((c) => selectedDupIds.has(c.id));
  };

  const handleGroupDelete = async (group: DuplicateGroup) => {
    const idsToDelete = group.companies
      .filter((c) => selectedDupIds.has(c.id))
      .map((c) => c.id);
    if (idsToDelete.length === 0) {
      toast.error(t('请先选择要删除的条目'));
      return;
    }
    setBatchDeleteConfirmOpen(true);
  };

  const handleGlobalBatchDelete = async () => {
    const ids = Array.from(selectedDupIds);
    if (ids.length === 0) return;
    setIsBatchDeleting(true);
    try {
      await restaurantsApi.batchDelete(id, ids);
      toast.success(t('已删除 {n} 条重复数据', { n: ids.length }));
      setBatchDeleteConfirmOpen(false);
      refreshAll();
      void refetchDuplicates();
      setSelectedDupIds(new Set());
    } catch (err: unknown) {
      logger.error('批量删除失败', err);
      toast.error(t('删除失败，请稍后重试'));
    } finally {
      setIsBatchDeleting(false);
    }
  };

  // --- Deep link / magic link handling ---
  useEffect(() => {
    if (!id || !listData?.items) return;
    const leadId = searchParams.get('lead');
    const action = searchParams.get('action');
    if (!leadId) return;

    const lead = listData.items.find((c: Company) => c.id === leadId);
    if (!lead) return;

    if (action === 'generate' && lead.status !== 'generated') {
      void handleGenerate(lead);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, searchParams, listData]);

  // --- Render ---
  if (projectLoading && !project) {
    return <div className="text-sm text-slate-500">{t('加载中...')}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Hidden file input for import */}
      <input
        type="file"
        accept=".xlsx"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFilePick}
      />

      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/" className="flex items-center gap-1">
                <Home size={14} />
                {t('首页')}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>
            <ChevronRight size={14} />
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <span className="text-sm text-slate-800 font-medium">
              {project?.name || t('项目')}
            </span>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="workbench">{t('工作台')}</TabsTrigger>
          <TabsTrigger value="info">{t('项目资料')}</TabsTrigger>
          <TabsTrigger value="duplicates">{t('查重')}</TabsTrigger>
        </TabsList>

        <TabsContent value="workbench" className="pt-4">
          <WorkbenchTab
            stats={stats}
            listData={listData}
            listLoading={listLoading}
            page={page}
            pageSize={pageSize}
            statusFilter={statusFilter}
            noEmailFilter={noEmailFilter}
            filterKey={filterKey}
            searchInput={searchInput}
            analyzingId={analyzingId}
            generatingId={generatingId}
            generatingWhatsAppId={generatingWhatsAppId}
            editingEmail={editingEmail}
            editingEmailLanguage={editingEmailLanguage}
            savingEmailId={savingEmailId}
            setPage={setPage}
            setStatusFilter={handleStatusChange}
            setSearchInput={setSearchInput}
            setEditingEmail={setEditingEmail}
            setEditingEmailLanguage={setEditingEmailLanguage}
            onSearch={handleSearch}
            onImportClick={handleImportClick}
            onImportDrop={handleDrop}
            onAnalyze={(r) => void handleAnalyze(r)}
            onGenerate={(r) => void handleGenerate(r)}
            onDelete={(r) => setDeletingCompany(r)}
            onSaveEmail={(r) => void saveEmailEdit(r)}
            onRegenerateEmail={(r) => void regenerateEmail(r)}
            projectId={id}
            onGenerateWhatsApp={(r) => void handleGenerateWhatsApp(r)}
            onStatClick={handleStatClick}
            onToggleStar={(r) => void handleToggleStar(r)}
            onUpdateContactStatus={(r, contactType, contacted) =>
              void handleUpdateContactStatus(r, contactType, contacted)
            }
          />
        </TabsContent>

        <TabsContent value="info" className="pt-4">
          <ProjectInfoTab
            project={project}
            editName={editName}
            editDescription={editDescription}
            isSavingProject={isSavingProject}
            isUploadingMaterial={isUploadingMaterial}
            setEditName={setEditName}
            setEditDescription={setEditDescription}
            onSaveProject={() => void handleSaveProject()}
            onUploadMaterial={(f) => void handleUploadMaterial(f)}
            onDeleteMaterial={(mid) => void handleDeleteMaterial(mid)}
            onStartEdit={handleStartEditProject}
          />
        </TabsContent>

        <TabsContent value="duplicates" className="pt-4">
          <DuplicatesTab
            duplicates={duplicates}
            dupLoading={dupLoading}
            checkingDuplicates={checkingDuplicates}
            selectedDupIds={selectedDupIds}
            onCheckDuplicates={() => void handleCheckDuplicates()}
            onToggleDup={toggleDupSelection}
            onToggleGroup={toggleGroupSelection}
            onKeepFirst={keepFirstInGroup}
            onGroupDelete={(g) => void handleGroupDelete(g)}
            onGlobalBatchDelete={() => setBatchDeleteConfirmOpen(true)}
            isGroupAllSelected={isGroupAllSelected}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <ImportDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        pendingFile={pendingFile}
        uploadMode={uploadMode}
        setUploadMode={setUploadMode}
        isUploading={isUploading}
        onConfirm={() => void confirmUpload()}
      />

      <DeleteConfirmDialog
        open={!!deletingCompany}
        onOpenChange={(open) => {
          if (!open) setDeletingCompany(null);
        }}
        companyName={deletingCompany?.name || ''}
        onConfirm={() => {
          if (deletingCompany) void handleDelete(deletingCompany);
        }}
      />

      <EmailDialog
        open={!!emailDialogCompany}
        onOpenChange={(open) => {
          if (!open) setEmailDialogCompany(null);
        }}
        company={emailDialogCompany}
        onCopy={(text, lang) => void copyToClipboard(text, lang)}
      />

      <BatchDeleteConfirmDialog
        open={batchDeleteConfirmOpen}
        onOpenChange={setBatchDeleteConfirmOpen}
        selectedCount={selectedDupIds.size}
        isDeleting={isBatchDeleting}
        onConfirm={() => void handleGlobalBatchDelete()}
      />
    </div>
  );
};

const ProjectWorkbenchPage: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectWorkbenchInner />
    </QueryClientProvider>
  );
};

export default ProjectWorkbenchPage;
