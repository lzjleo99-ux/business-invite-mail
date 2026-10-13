import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { LogIn, Mail, Lock } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requestResetCode, resetPassword } from '@/api/auth';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n';

const LoginPage: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  // 忘记密码：两步（发验证码 → 填码设新密码）
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<'email' | 'code'>('email');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotPassword, setForgotPassword] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);

  const loginSchema = z.object({
    email: z
      .string()
      .min(1, t('邮箱不能为空'))
      .email(t('邮箱格式不正确')),
    password: z.string().min(1, t('密码不能为空')),
  });
  type LoginFormValues = z.infer<typeof loginSchema>;

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitting(true);
    try {
      await login(values.email, values.password);
      toast.success(t('登录成功'));
      navigate('/');
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : t('登录失败，请检查邮箱和密码');
      toast.error(t('登录失败'), { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <LogIn className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl font-bold text-slate-800">
            {t('登录')}
          </CardTitle>
          <p className="text-sm text-slate-500">
            {t('BD 邮件生成系统')}
          </p>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('邮箱')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          type="email"
                          placeholder="name@example.com"
                          className="pl-10"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('密码')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          type="password"
                          placeholder="••••••••"
                          className="pl-10"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? t('登录中...') : t('登录')}
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm text-slate-500">
            {t('没有账号？')}{' '}
            <Link
              to="/register"
              className="font-medium text-primary hover:underline"
            >
              {t('去注册')}
            </Link>
          </div>
          <div className="mt-2 text-center text-sm">
            <button
              type="button"
              onClick={() => {
                setForgotOpen(true);
                setForgotStep('email');
                setForgotCode('');
                setForgotPassword('');
              }}
              className="font-medium text-primary hover:underline"
            >
              {t('忘记密码？')}
            </button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('找回密码')}</DialogTitle>
            <DialogDescription>
              {forgotStep === 'email'
                ? t('输入注册邮箱，我们会发送 6 位验证码（10 分钟内有效）。')
                : t('输入邮箱收到的验证码，并设置新密码。')}
            </DialogDescription>
          </DialogHeader>

          {forgotStep === 'email' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="forgot-email">{t('邮箱')}</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  value={forgotEmail}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setForgotEmail(e.target.value)
                  }
                  placeholder="name@company.com"
                />
              </div>
              <Button
                className="w-full"
                disabled={forgotBusy || !forgotEmail}
                onClick={async () => {
                  setForgotBusy(true);
                  try {
                    const res = await requestResetCode(forgotEmail.trim());
                    toast.success(t('验证码已发送'), {
                      description: res.message,
                    });
                    setForgotStep('code');
                  } catch (err: unknown) {
                    toast.error(t('发送失败'), {
                      description: err instanceof Error ? err.message : String(err),
                    });
                  } finally {
                    setForgotBusy(false);
                  }
                }}
              >
                {forgotBusy ? t('发送中...') : t('发送验证码')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="forgot-code">{t('验证码')}</Label>
                <Input
                  id="forgot-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={forgotCode}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setForgotCode(e.target.value.replace(/\D/g, ''))
                  }
                  placeholder="6 位数字"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="forgot-password">{t('新密码')}</Label>
                <Input
                  id="forgot-password"
                  type="text"
                  value={forgotPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setForgotPassword(e.target.value)
                  }
                  placeholder={t('至少 8 位，含字母和数字')}
                />
              </div>
              <Button
                className="w-full"
                disabled={forgotBusy || forgotCode.length !== 6 || forgotPassword.length < 8}
                onClick={async () => {
                  setForgotBusy(true);
                  try {
                    await resetPassword({
                      email: forgotEmail.trim(),
                      code: forgotCode.trim(),
                      newPassword: forgotPassword,
                    });
                    toast.success(t('密码已重置，请用新密码登录'));
                    setForgotOpen(false);
                    setForgotStep('email');
                    setForgotCode('');
                    setForgotPassword('');
                  } catch (err: unknown) {
                    toast.error(t('重置失败'), {
                      description: err instanceof Error ? err.message : String(err),
                    });
                  } finally {
                    setForgotBusy(false);
                  }
                }}
              >
                {forgotBusy ? t('提交中...') : t('重置密码')}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setForgotStep('email')}
              >
                {t('换个邮箱')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LoginPage;
