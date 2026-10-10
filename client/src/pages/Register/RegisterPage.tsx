import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { UserPlus, Mail, Lock, User } from 'lucide-react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n';

const RegisterPage: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { register: registerAuth } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const registerSchema = z
    .object({
      email: z
        .string()
        .min(1, t('邮箱不能为空'))
        .email(t('邮箱格式不正确')),
      displayName: z.string().min(1, t('显示名称不能为空')),
      password: z
        .string()
        .min(1, t('密码不能为空'))
        .min(8, t('密码至少 8 位'))
        .regex(/[A-Za-z]/, t('密码必须包含字母'))
        .regex(/[0-9]/, t('密码必须包含数字')),
      confirmPassword: z.string().min(1, t('请确认密码')),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('两次密码输入不一致'),
      path: ['confirmPassword'],
    });
  type RegisterFormValues = z.infer<typeof registerSchema>;

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      displayName: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async (values: RegisterFormValues) => {
    setSubmitting(true);
    try {
      await registerAuth(values.email, values.password, values.displayName);
      toast.success(t('注册成功'));
      navigate('/');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : t('注册失败，请稍后重试');
      toast.error(t('注册失败'), { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-slate-50 px-4 py-8">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <UserPlus className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl font-bold text-slate-800">
            {t('注册账号')}
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
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('显示名称')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          type="text"
                          placeholder={t('请输入显示名称')}
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
                          placeholder={t('至少 8 位，含字母和数字')}
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
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('确认密码')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          type="password"
                          placeholder={t('再次输入密码')}
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
                {submitting ? t('注册中...') : t('注册')}
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm text-slate-500">
            {t('已有账号？')}{' '}
            <Link
              to="/login"
              className="font-medium text-primary hover:underline"
            >
              {t('去登录')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RegisterPage;
