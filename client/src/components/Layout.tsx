import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  FolderKanban,
  Settings,
  Languages,
  Shield,
  LogOut,
  KeyRound,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@client/src/i18n';

const Layout: React.FC = () => {
  const { lang, toggle, t } = useI18n();
  const { user, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  const navItems = [
    { to: '/', label: t('项目列表'), icon: FolderKanban },
    { to: '/settings', label: t('设置'), icon: Settings },
  ];

  if (user?.role === 'admin') {
    navItems.push({ to: '/admin/users', label: t('用户管理'), icon: Shield });
  }

  const passwordSchema = z
    .object({
      oldPassword: z.string().min(1, t('当前密码不能为空')),
      newPassword: z
        .string()
        .min(1, t('新密码不能为空'))
        .min(8, t('密码至少 8 位'))
        .regex(/[A-Za-z]/, t('密码必须包含字母'))
        .regex(/[0-9]/, t('密码必须包含数字')),
      confirmPassword: z.string().min(1, t('请确认新密码')),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: t('两次密码输入不一致'),
      path: ['confirmPassword'],
    });
  type PasswordFormValues = z.infer<typeof passwordSchema>;

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const handleLogout = async () => {
    await logout();
    toast.success(t('已退出登录'));
    navigate('/login');
  };

  const handleChangePassword = async (values: PasswordFormValues) => {
    setPasswordSubmitting(true);
    try {
      await changePassword(values.oldPassword, values.newPassword);
      toast.success(t('密码修改成功'));
      setPasswordDialogOpen(false);
      passwordForm.reset();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : t('密码修改失败，请重试');
      toast.error(t('密码修改失败'), { description: msg });
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const initials = user?.displayName
    ? user.displayName.charAt(0).toUpperCase()
    : '?';

  return (
    <div className="flex h-screen w-screen bg-slate-50">
      <aside className="w-60 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="flex h-16 items-center border-b border-slate-200 px-5">
          <h1 className="text-lg font-bold text-slate-800">{t('BD 邮件助手')}</h1>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-slate-200">
          {user && (
            <div className="p-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-slate-100"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {initials}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-slate-800">
                          {user.displayName}
                        </span>
                      </div>
                      <div className="mt-0.5">
                        {user.role === 'admin' ? (
                          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px] px-1.5 py-0">
                            <Shield size={10} className="mr-0.5" />
                            {t('管理员')}
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {t('普通用户')}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronDown size={14} className="text-slate-400" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-2 py-1.5">
                    <p className="text-xs text-slate-400">{t('已登录')}</p>
                    <p className="text-sm font-medium text-slate-700">
                      {user.email}
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setPasswordDialogOpen(true)}>
                    <KeyRound size={14} className="mr-2" />
                    {t('修改密码')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-red-600"
                  >
                    <LogOut size={14} className="mr-2" />
                    {t('退出登录')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          <div className="p-3 pt-0">
            <button
              type="button"
              onClick={toggle}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <Languages size={18} />
              <span>{lang === 'en' ? '中文 / English' : t('English')}</span>
              <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                {lang === 'en' ? 'EN' : '中'}
              </span>
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="min-h-full p-6">
          <Outlet />
        </div>
      </main>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound size={18} className="text-primary" />
              {t('修改密码')}
            </DialogTitle>
          </DialogHeader>
          <Form {...passwordForm}>
            <form
              onSubmit={passwordForm.handleSubmit(handleChangePassword)}
              className="space-y-4"
            >
              <FormField
                control={passwordForm.control}
                name="oldPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('当前密码')}</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('新密码')}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={t('至少 8 位，含字母和数字')}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('确认新密码')}</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPasswordDialogOpen(false)}
                >
                  {t('取消')}
                </Button>
                <Button type="submit" disabled={passwordSubmitting}>
                  {passwordSubmitting ? t('提交中...') : t('确认修改')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Layout;
