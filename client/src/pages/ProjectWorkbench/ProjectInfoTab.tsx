import React from 'react';
import { toast } from 'sonner';
import {
  Upload,
  Save,
  Trash2,
  Loader2,
  FileText,
  Copy,
} from 'lucide-react';
import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';

import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import type { Project } from '@shared/api.interface';
import { useI18n } from '@client/src/i18n';

const formatFileSize = (bytes: number | null): string => {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export interface ProjectInfoTabProps {
  project: Project | undefined;
  editName: string;
  editDescription: string;
  isSavingProject: boolean;
  isUploadingMaterial: boolean;
  setEditName: (v: string) => void;
  setEditDescription: (v: string) => void;
  onSaveProject: () => void;
  onUploadMaterial: (file: File) => void;
  onDeleteMaterial: (materialId: string) => void;
  onStartEdit: () => void;
}

const ProjectInfoTab: React.FC<ProjectInfoTabProps> = ({
  project,
  editName,
  editDescription,
  isSavingProject,
  isUploadingMaterial,
  setEditName,
  setEditDescription,
  onSaveProject,
  onUploadMaterial,
  onDeleteMaterial,
  onStartEdit,
}) => {
  const { t } = useI18n();

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onUploadMaterial(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    onUploadMaterial(file);
  };

  const handleCopyProjectLink = async () => {
    if (!project) return;
    const url = resolveAppUrl(`/projects/${project.id}`);
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('项目链接已复制'));
    } catch {
      toast.error(t('复制失败'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Basic info */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center justify-between">
            <span>{t('项目资料')}</span>
            <Button variant="outline" size="sm" onClick={handleCopyProjectLink}>
              <Copy size={14} />
              {t('复制项目链接')}
            </Button>
          </h3>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">
              {t('项目名称')}
            </label>
            <Input
              value={editName || project?.name || ''}
              onChange={(e) => setEditName(e.target.value)}
              onFocus={onStartEdit}
              placeholder={t('请输入项目名称')}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">
              {t('项目简介')}
            </label>
            <Textarea
              value={editDescription || project?.description || ''}
              onChange={(e) => setEditDescription(e.target.value)}
              onFocus={onStartEdit}
              placeholder={t('请输入项目简介，AI 生成邮件时会参考此内容')}
              rows={6}
            />
          </div>
          <div className="flex justify-end">
            <Button
              variant="default"
              onClick={onSaveProject}
              disabled={isSavingProject}
            >
              {isSavingProject && (
                <Loader2 className="animate-spin" size={16} />
              )}
              <Save size={16} />
              {t('保存')}
            </Button>
          </div>
        </div>
      </div>

      {/* Materials */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-lg font-semibold text-slate-800">{t('素材文件')}</h3>

        {/* Upload area */}
        <input
          type="file"
          accept=".pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp"
          multiple
          className="hidden"
          id="material-upload-input"
          onChange={handleFilePick}
        />
        <div
          className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
          onClick={() =>
            document.getElementById('material-upload-input')?.click()
          }
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {isUploadingMaterial ? (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={20} />
              {t('上传中...')}
            </div>
          ) : (
            <>
              <Upload
                size={32}
                className="mx-auto text-slate-400 mb-2"
              />
              <p className="text-sm text-slate-600 font-medium">
                {t('拖拽文件到此处，或点击上传')}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {t('支持 PDF / Excel / Word / 图片')}
              </p>
            </>
          )}
        </div>

        {/* File list */}
        {project?.materials && project.materials.length > 0 ? (
          <div className="space-y-2">
            {project.materials.map((mat) => (
              <div
                key={mat.id}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex-shrink-0 w-9 h-9 rounded bg-slate-100 flex items-center justify-center">
                    <FileText size={18} className="text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {mat.fileName}
                    </p>
                    <p className="text-xs text-slate-400">
                      {mat.fileType} · {formatFileSize(mat.fileSize)} ·{' '}
                      {mat.createdAt
                        ? new Date(mat.createdAt).toLocaleDateString()
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm">
                    {t('预览')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={() => onDeleteMaterial(mat.id)}
                  >
                    <Trash2 size={14} />
                    {t('删除')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-slate-400">
            {t('暂无素材文件')}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectInfoTab;
