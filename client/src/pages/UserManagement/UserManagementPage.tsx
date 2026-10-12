import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Shield, UserX, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import * as adminApi from '@/api/admin';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n';
import type { AdminUser } from '@shared/api.interface';

const UserManagementPage: React.FC = () => {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  // 创建账号（公开注册已关闭，账号统一由管理员发放）
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', page, pageSize, search],
    queryFn: () => adminApi.listUsers({ page, pageSize, search: search || undefined }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'user' }) =>
      adminApi.updateUserRole(userId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success(t('角色已更新'));
    },
    onError: (err: unknown) => {
      toast.error(t('更新失败'), {
        description: err instanceof Error ? err.message : t('未知错误'),
      });
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      adminApi.updateUserActive(userId, isActive),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success(t('状态已更新'));
    },
    onError: (err: unknown) => {
      toast.error(t('更新失败'), {
        description: err instanceof Error ? err.message : t('未知错误'),
      });
    },
  });

  const handleSearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  const isSelf = (u: AdminUser): boolean => user?.id === u.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('用户管理')}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('管理系统用户、角色与状态')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder={t('搜索邮箱或名称')}
              value={searchInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSearchInput(e.target.value)
              }
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') handleSearch();
              }}
              className="w-64 pl-10"
            />
          </div>
          <Button onClick={handleSearch} variant="default">
            {t('搜索')}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            {t('创建用户')}
          </Button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('创建用户')}</DialogTitle>
            <DialogDescription>
              {t('为团队成员创建账号，对方登录后在设置里填自己的 API Key。')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="new-user-email">{t('邮箱')}</Label>
              <Input
                id="new-user-email"
                type="email"
                value={newEmail}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNewEmail(e.target.value)
                }
                placeholder="name@company.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-user-name">{t('显示名称')}</Label>
              <Input
                id="new-user-name"
                value={newName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNewName(e.target.value)
                }
                placeholder={t('显示名称')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-user-password">{t('初始密码')}</Label>
              <Input
                id="new-user-password"
                type="text"
                value={newPassword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNewPassword(e.target.value)
                }
                placeholder={t('至少 8 位，含字母和数字')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                if (!newEmail || !newPassword) {
                  toast.error(t('请填写邮箱和密码'));
                  return;
                }
                setCreating(true);
                try {
                  await adminApi.createUser({
                    email: newEmail,
                    password: newPassword,
                    displayName: newName || newEmail.split('@')[0],
                  });
                  toast.success(t('账号已创建'));
                  setCreateOpen(false);
                  setNewEmail('');
                  setNewName('');
                  setNewPassword('');
                  void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
                } catch (err: unknown) {
                  toast.error(t('创建失败'), {
                    description:
                      err instanceof Error ? err.message : String(err),
                  });
                } finally {
                  setCreating(false);
                }
              }}
              disabled={creating}
            >
              {creating ? t('创建中...') : t('创建')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users size={18} className="text-slate-600" />
            {t('用户列表')}
            <Badge variant="secondary" className="ml-1">
              {data?.total ?? 0}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-slate-400">
              {t('加载中...')}
            </div>
          ) : data?.items && data.items.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('邮箱')}</TableHead>
                    <TableHead>{t('显示名称')}</TableHead>
                    <TableHead>{t('角色')}</TableHead>
                    <TableHead>{t('状态')}</TableHead>
                    <TableHead>{t('创建时间')}</TableHead>
                    <TableHead className="text-right">{t('操作')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item: AdminUser) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-slate-700">
                        {item.email}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {item.displayName}
                      </TableCell>
                      <TableCell>
                        {item.role === 'admin' ? (
                          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                            <Shield size={12} className="mr-1" />
                            {t('管理员')}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{t('普通用户')}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.isActive ? (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                            {t('启用')}
                          </Badge>
                        ) : (
                          <Badge className="bg-slate-200 text-slate-600 hover:bg-slate-200">
                            {t('禁用')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {new Date(item.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSelf(item) || roleMutation.isPending}
                            onClick={() =>
                              roleMutation.mutate({
                                userId: item.id,
                                role: item.role === 'admin' ? 'user' : 'admin',
                              })
                            }
                          >
                            {item.role === 'admin'
                              ? t('降为普通用户')
                              : t('设为管理员')}
                          </Button>
                          <Button
                            size="sm"
                            variant={item.isActive ? 'destructive' : 'default'}
                            disabled={isSelf(item) || activeMutation.isPending}
                            onClick={() =>
                              activeMutation.mutate({
                                userId: item.id,
                                isActive: !item.isActive,
                              })
                            }
                          >
                            {item.isActive ? (
                              <>
                                <UserX size={14} className="mr-1" />
                                {t('禁用')}
                              </>
                            ) : (
                              <>
                                <UserCheck size={14} className="mr-1" />
                                {t('启用')}
                              </>
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
                <p className="text-xs text-slate-500">
                  {t('共 {total} 条', { total: String(data.total) })}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t('上一页')}
                  </Button>
                  <span className="flex items-center px-2 text-sm text-slate-600">
                    {t('第 {page} / {totalPages} 页', {
                      page: String(page),
                      totalPages: String(totalPages),
                    })}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('下一页')}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-sm text-slate-400">
              {t('暂无用户')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UserManagementPage;
