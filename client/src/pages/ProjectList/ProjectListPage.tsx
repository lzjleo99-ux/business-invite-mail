import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useQuery,
  useMutation,
  useQueryClient,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  Plus,
  Trash2,
  Building2,
  Mail,
  FolderPlus,
  Loader2,
} from 'lucide-react';

import * as projectsApi from '@client/src/api/projects';
import { Button } from '@client/src/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@client/src/components/ui/card';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
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
import type { Project } from '@shared/api.interface';
import { useI18n } from '@client/src/i18n';

const queryClient = new QueryClient();

function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const ProjectListPageInner: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useI18n();

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  const { data: projects, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getProjects(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      projectsApi.createProject(data),
    onSuccess: (project) => {
      toast.success(t('项目创建成功'));
      setCreateOpen(false);
      setCreateName('');
      setCreateDesc('');
      qc.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${project.id}`);
    },
    onError: (err: unknown) => {
      logger.error('创建项目失败', err);
      toast.error(t('创建项目失败'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.deleteProject(id),
    onSuccess: () => {
      toast.success(t('项目已删除'));
      setDeletingProject(null);
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err: unknown) => {
      logger.error('删除项目失败', err);
      toast.error(t('删除项目失败'));
    },
  });

  const handleCreate = () => {
    if (!createName.trim()) {
      toast.error(t('请输入项目名称'));
      return;
    }
    createMutation.mutate({
      name: createName.trim(),
      description: createDesc.trim(),
    });
  };

  const handleCardClick = (projectId: string) => {
    navigate(`/projects/${projectId}`);
  };

  const handleDeleteClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    project: Project,
  ) => {
    e.stopPropagation();
    setDeletingProject(project);
  };

  if (error && !projects) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">{t('项目管理')}</h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center py-16">
            <p className="text-sm text-slate-500 mb-4">{t('加载项目列表失败')}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ['projects'] })}
            >
              {t('重试')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('项目管理')}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('管理你的 BD 拓展项目，上传资料并生成个性化邮件')}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('新建项目')}
        </Button>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="p-5 pb-0">
                <div className="h-5 w-2/3 bg-slate-200 rounded" />
              </CardHeader>
              <CardContent className="p-5">
                <div className="space-y-2 mt-3">
                  <div className="h-3 bg-slate-100 rounded" />
                  <div className="h-3 bg-slate-100 rounded w-5/6" />
                  <div className="h-3 bg-slate-100 rounded w-4/6" />
                </div>
              </CardContent>
              <CardFooter className="p-5 pt-0">
                <div className="h-3 w-1/3 bg-slate-100 rounded" />
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!projects || projects.length === 0) && (
        <Card>
          <CardContent className="flex flex-col items-center py-16">
            <FolderPlus className="h-12 w-12 text-slate-300 mb-4" />
            <p className="text-sm text-slate-500 mb-2">{t('还没有项目')}</p>
            <p className="text-xs text-slate-400 mb-6">
              {t('创建第一个项目，开始你的 BD 拓展之旅')}
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('新建项目')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Project grid */}
      {!isLoading && projects && projects.length > 0 && (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          data-ai-section-type="card-list"
        >
          {projects.map((project: Project) => (
            <Card
              key={project.id}
              className="flex flex-col cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
              onClick={() => handleCardClick(project.id)}
            >
              <CardHeader className="p-5 pb-0">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-lg font-semibold truncate">
                    {project.name}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-destructive shrink-0"
                    onClick={(e) => handleDeleteClick(e, project)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-5 flex-1">
                <p className="text-sm text-slate-600 line-clamp-3 leading-relaxed">
                  {project.description || t('暂无简介')}
                </p>
              </CardContent>

              <CardFooter className="p-5 pt-0 flex-col items-start gap-3">
                <div className="flex items-center gap-4 w-full">
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Building2 className="h-3.5 w-3.5 text-slate-400" />
                    {project.companyCount} {t('家公司')}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    {project.generatedCount} {t('封已生成')}
                  </span>
                </div>
                <div className="w-full text-right text-xs text-slate-400">
                  {t('创建于 {date}', { date: formatDate(project.createdAt) })}
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Create project dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('新建项目')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                {t('项目名称')}
              </label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t('请输入项目名称')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                {t('项目简介')}
              </label>
              <Textarea
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder={t('请输入项目简介，用于邮件生成时的背景介绍')}
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              {t('取消')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t('创建')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <AlertDialog
        open={!!deletingProject}
        onOpenChange={(open) => !open && setDeletingProject(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('确认删除项目')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('确定要删除项目「{name}」吗？', { name: deletingProject?.name ?? '' })}
              {' '}
              {t('项目内的所有资料和公司数据都会被删除，此操作不可撤销。')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t('取消')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deletingProject && deleteMutation.mutate(deletingProject.id)
              }
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground"
            >
              {deleteMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t('确认删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const ProjectListPage: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectListPageInner />
    </QueryClientProvider>
  );
};

export default ProjectListPage;
