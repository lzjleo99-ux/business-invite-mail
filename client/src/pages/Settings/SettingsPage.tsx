import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Bell,
  Bot,
  Copy,
  Cpu,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  User,
} from 'lucide-react';
import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import * as modelConfigApi from '@/api/model-config';
import * as senderConfigApi from '@/api/sender-config';
import * as adminApi from '@/api/admin';
import * as emailGeneratorApi from '@/api/email-generator';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n';
import { mergeModelLists, isReasoningModel, detectFamily, findProviderByModel } from '@shared/model-catalog';
import type {
  ModelConfig,
  SenderConfig,
  UpdateSenderConfigRequest,
  TestConnectionRequest,
} from '@shared/api.interface';

const SettingsPage = () => {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'model' | 'sender' | 'robot' | 'mail'>('model');
  const { user } = useAuth();
  // 管理员级：admin 与 super_admin 都算。只判 'admin' 会把超级管理员挡在
  // 「发信服务」标签外面——而 super_admin 是权限最高的角色，反而看不到配置。
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  // SMTP 发信配置（仅管理员可见，服务端也仅管理员可写）
  const [smtp, setSmtp] = useState({
    host: '',
    port: '465',
    secure: true,
    username: '',
    password: '',
    fromName: '',
    fromEmail: '',
    passwordSet: false,
    configured: false,
    // IMAP 收信（同一授权码）
    imapHost: '',
    imapPort: '993',
    imapSecure: true,
    inboxPollEnabled: false,
    inboxPollSeconds: '180',
  });
  // 已保存配置是异步读的：读之前先显示"读取中"，否则会先渲染一堆占位文字，
  // 看起来像"什么都没填"（占位符 noreply@… 会被误认成真实值）。

  // ---- 多个发信账号（邮箱后台）----
  const [accounts, setAccounts] = useState<adminApi.SmtpAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  /**
   * 邮箱列表加载失败（和"真的是空的"是两回事）。
   * 之前失败时静默当作空列表，界面显示"还没有可用邮箱"——
   * 用户会以为配置丢了。实际发生过：服务端重启后首次查询失败。
   */
  const [accountsError, setAccountsError] = useState<string | null>(null);
  /**
   * 邮箱编辑状态：null = 收起（只看列表）；'new' = 新建；否则是账号 id = 编辑该账号。
   * 设计：进页面先看有哪些邮箱可用，点某个才展开编辑，右上角「添加邮箱」新建。
   */
  const [editingAccount, setEditingAccount] = useState<string | 'new' | null>(null);
  const [accountForm, setAccountForm] = useState({
    email: '',
    password: '',
    host: '',
    port: '465',
    secure: true,
    fromName: '',
    // 收件：跟着邮箱走
    imapHost: '',
    imapPort: '993',
    imapSecure: true,
    inboxPollEnabled: false,
    inboxPollSeconds: '180',
  });
  const [accountBusy, setAccountBusy] = useState(false);
  /** 默认收发邮箱：发送不选账号时用它，后台收取也读它的 IMAP 配置 */
  const defaultAccount = accounts.find((a) => a.isDefault) ?? accounts[0];
  const refreshAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      setAccounts(await adminApi.listSmtpAccounts());
    } catch (err: unknown) {
      // 重试一次：服务端刚重启时首次请求可能失败（补列迁移与查询竞争）
      try {
        await new Promise((r) => setTimeout(r, 800));
        setAccounts(await adminApi.listSmtpAccounts());
      } catch (err2: unknown) {
        setAccounts([]);
        setAccountsError(err2 instanceof Error ? err2.message : String(err2));
      }
    } finally {
      setAccountsLoading(false);
    }
  }, []);
  useEffect(() => { void refreshAccounts(); }, [refreshAccounts]);

  /** 打开某个账号的编辑表单：用当前值填充（授权码也直接显示，不隐藏） */
  const openAccountEditor = (a: adminApi.SmtpAccount) => {
    setAccountForm({
      email: a.email,
      password: a.password,
      host: a.host,
      port: String(a.port),
      secure: a.secure,
      fromName: a.fromName ?? '',
      imapHost: a.imapHost ?? '',
      imapPort: String(a.imapPort || 993),
      imapSecure: a.imapSecure !== false,
      inboxPollEnabled: a.inboxPollEnabled === true,
      inboxPollSeconds: String(a.inboxPollSeconds || 180),
    });
    setEditingAccount(a.id);
  };

  const openNewAccount = () => {
    setAccountForm({
      email: '', password: '', host: '', port: '465', secure: true, fromName: '',
      imapHost: '', imapPort: '993', imapSecure: true, inboxPollEnabled: false, inboxPollSeconds: '180',
    });
    setEditingAccount('new');
  };

  // 企业微信群机器人通知。webhook 之前按"只写不读"处理，但用户明确要
  // 已保存的地址一直显示（空的看起来像被删了），后端本来就回传原文，直接展示。
  const [wecom, setWecom] = useState({
    webhookUrl: '',
    enabled: false,
    autoStarOnReply: true,
    includeSnippet: true,
    webhookSet: false,
  });
  const [wecomBusy, setWecomBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    void adminApi
      .getWecomNotifyConfig()
      .then((c) =>
        setWecom({
          webhookUrl: (c as { webhookUrl?: string }).webhookUrl ?? '',
          enabled: !!c.enabled,
          autoStarOnReply: c.autoStarOnReply !== false,
          includeSnippet: c.includeSnippet !== false,
          webhookSet: !!c.webhookSet,
        }),
      )
      .catch(() => undefined);
  }, [isAdmin]);

  /** 保存（新增或编辑同一个入口）：所有字段直接提交，不搞"留空表示不修改" */
  const handleSaveAccount = async () => {
    if (!accountForm.email.trim() || !accountForm.password || !accountForm.host.trim()) {
      toast.error(t('邮箱、授权码/密码、SMTP 服务器都不能为空'));
      return;
    }
    setAccountBusy(true);
    try {
      const payload = {
        email: accountForm.email.trim(),
        password: accountForm.password,
        host: accountForm.host.trim(),
        port: Number(accountForm.port) || 465,
        secure: accountForm.secure,
        fromName: accountForm.fromName.trim() || undefined,
        imapHost: accountForm.imapHost.trim() || null,
        imapPort: Number(accountForm.imapPort) || 993,
        imapSecure: accountForm.imapSecure,
        inboxPollEnabled: accountForm.inboxPollEnabled,
        inboxPollSeconds: Number(accountForm.inboxPollSeconds) || 180,
      };
      if (editingAccount === 'new') {
        await adminApi.addSmtpAccount(payload);
        toast.success(t('邮箱已添加'));
      } else if (editingAccount) {
        await adminApi.updateSmtpAccount(editingAccount, payload);
        toast.success(t('已保存'));
      }
      setEditingAccount(null);
      await refreshAccounts();
    } catch (err: unknown) {
      toast.error(t('保存失败'), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setAccountBusy(false);
    }
  };

  const handleDeleteAccount = async (id: string, email: string) => {
    setAccountBusy(true);
    try {
      await adminApi.deleteSmtpAccount(id);
      toast.success(t('已删除 {e}', { e: email }));
      if (editingAccount === id) setEditingAccount(null);
      await refreshAccounts();
    } catch (err: unknown) {
      toast.error(t('删除失败'), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setAccountBusy(false);
    }
  };

  const handleSetDefaultAccount = async (id: string) => {
    setAccountBusy(true);
    try {
      await adminApi.setDefaultSmtpAccount(id);
      await refreshAccounts();
    } catch (err: unknown) {
      toast.error(t('设置默认失败'), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setAccountBusy(false);
    }
  };

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const modelFormSchema = z.object({
    apiBaseUrl: z.string().min(1, t('API Base URL 不能为空')),
    apiKey: z.string().optional(),
    modelName: z.string().min(1, t('模型名称不能为空')),
    temperature: z.number().min(0).max(2).nullable(),
    emailLanguage: z.enum(['auto', 'serbian', 'english', 'chinese']),
    senderSignature: z.string(),
  });
  type ModelFormValues = z.infer<typeof modelFormSchema>;

  const senderFormSchema = z.object({
    senderName: z.string().min(1, t('姓名不能为空')),
    senderTitle: z.string(),
    personalStory: z.string(),
  });
  type SenderFormValues = z.infer<typeof senderFormSchema>;

  // ---- 模型设置 ----
  const { data: config, isLoading: modelLoading } = useQuery({
    queryKey: ['model-config'],
    queryFn: modelConfigApi.getModelConfig,
  });

  const modelForm = useForm<ModelFormValues>({
    resolver: zodResolver(modelFormSchema),
    values: config
      ? {
          apiBaseUrl: config.apiBaseUrl,
          apiKey: '',
          modelName: config.modelName,
          temperature: config.temperature,
          emailLanguage: config.emailLanguage as ModelFormValues['emailLanguage'],
          senderSignature: config.senderSignature,
        }
      : {
          apiBaseUrl: '',
          apiKey: '',
          modelName: '',
          temperature: null,
          emailLanguage: 'auto',
          senderSignature: '',
        },
    disabled: modelLoading,
  });

  // 可选模型列表（设置页下拉框用）
  const { data: modelOptions } = useQuery({
    queryKey: ['model-options'],
    queryFn: () => modelConfigApi.listModels(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // 内置目录（按公司分组）+ 当前 API 返回的模型，合并去重
  const modelGroups = useMemo(
    () => mergeModelLists(modelOptions?.models ?? []),
    [modelOptions],
  );
  /** 当前所选模型属于哪家供应商（决定自动填哪个官方端点） */
  const watchedModel = modelForm.watch('modelName');
  const selectedProvider = useMemo(
    () => modelGroups.find((g) => g.models.some((m) => m.id === watchedModel)) ?? null,
    [modelGroups, watchedModel],
  );

  const updateMutation = useMutation({
    mutationFn: (values: ModelFormValues) => {
      const payload: Parameters<typeof modelConfigApi.updateModelConfig>[0] = {
        apiBaseUrl: values.apiBaseUrl,
        modelName: values.modelName,
        temperature: values.temperature,
        emailLanguage: values.emailLanguage,
        senderSignature: values.senderSignature,
      };
      if (values.apiKey && values.apiKey.trim().length > 0) {
        payload.apiKey = values.apiKey;
      }
      return modelConfigApi.updateModelConfig(payload);
    },
    onSuccess: (result: ModelConfig) => {
      queryClient.setQueryData(['model-config'], result);
      modelForm.reset({
        apiBaseUrl: result.apiBaseUrl,
        apiKey: '',
        modelName: result.modelName,
        temperature: result.temperature,
        emailLanguage: result.emailLanguage as ModelFormValues['emailLanguage'],
        senderSignature: result.senderSignature,
      });
      toast.success(t('模型设置已保存'));
    },
    onError: (err: unknown) => {
      toast.error(t('保存失败'), {
        description: err instanceof Error ? err.message : t('未知错误'),
      });
    },
  });

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const formValues = modelForm.getValues();
      const payload: TestConnectionRequest = {
        apiBaseUrl: formValues.apiBaseUrl,
        apiKey: formValues.apiKey || undefined,
        modelName: formValues.modelName,
        temperature: formValues.temperature,
      };
      const result = await modelConfigApi.testConnection(payload);
      const msg = result.message ?? '';
      setTestResult({ success: result.success, message: msg });
      if (result.success) {
        toast.success(t('连接成功'));
      } else {
        toast.error(t('连接失败'), { description: msg });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('未知错误');
      setTestResult({ success: false, message: msg });
      toast.error(t('测试连接失败'), { description: msg });
    } finally {
      setTesting(false);
    }
  };

  const onModelSubmit = (values: ModelFormValues) => {
    updateMutation.mutate(values);
  };

  // ---- 发件人配置 ----
  const { data: senderConfig, isLoading: senderLoading } = useQuery({
    queryKey: ['sender-config'],
    queryFn: senderConfigApi.getSenderConfig,
  });

  const senderForm = useForm<SenderFormValues>({
    resolver: zodResolver(senderFormSchema),
    values: senderConfig
      ? {
          senderName: senderConfig.senderName,
          senderTitle: senderConfig.senderTitle ?? '',
          personalStory: senderConfig.personalStory ?? '',
        }
      : {
          senderName: 'Zijian Lang',
          senderTitle: 'Global Sourcing Specialist',
          personalStory:
            '曾在英国 Cranfield University（位于米尔顿凯恩斯 Milton Keynes 附近）留学，对英国市场有深厚感情和深入了解，也因此更加珍惜每一次与英国企业合作的机会。',
        },
    disabled: senderLoading,
  });

  const senderUpdateMutation = useMutation({
    mutationFn: (values: UpdateSenderConfigRequest) =>
      senderConfigApi.updateSenderConfig(values),
    onSuccess: (result: SenderConfig) => {
      queryClient.setQueryData(['sender-config'], result);
      senderForm.reset({
        senderName: result.senderName,
        senderTitle: result.senderTitle ?? '',
        personalStory: result.personalStory ?? '',
      });
      toast.success(t('发件人设置已保存'));
    },
    onError: (err: unknown) => {
      toast.error(t('保存失败'), {
        description: err instanceof Error ? err.message : t('未知错误'),
      });
    },
  });

  const onSenderSubmit = (values: SenderFormValues) => {
    senderUpdateMutation.mutate(values);
  };

  // ---- 导入密钥 / 机器人对接 ----
  const { data: importSecretData, isLoading: secretLoading } = useQuery({
    queryKey: ['import-secret'],
    queryFn: modelConfigApi.getImportSecret,
  });

  const [secretInput, setSecretInput] = useState('');
  const [savingSecret, setSavingSecret] = useState(false);

  const generateSecret = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setSecretInput(result);
  };

  const saveSecret = async () => {
    if (!secretInput.trim()) {
      toast.error(t('请输入或生成密钥'));
      return;
    }
    setSavingSecret(true);
    try {
      await modelConfigApi.updateImportSecret({ importSecret: secretInput.trim() });
      void queryClient.invalidateQueries({ queryKey: ['import-secret'] });
      setSecretInput('');
      toast.success(t('导入密钥已保存'));
    } catch (err: unknown) {
      toast.error(t('保存失败'), {
        description: err instanceof Error ? err.message : t('未知错误'),
      });
    } finally {
      setSavingSecret(false);
    }
  };

  const copyRobotEndpoint = async () => {
    const url = resolveAppUrl('/openapi/auto-import/leads');
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('接口地址已复制'));
    } catch {
      toast.error(t('复制失败'));
    }
  };

  const copySecret = async () => {
    toast.error(t('出于安全考虑，密钥不支持从前端复制'));
  };

  const loading = modelLoading || senderLoading;

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('设置')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('配置模型与发件人信息')}</p>
        </div>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-400">{t('加载中...')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
<>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('设置')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('配置模型与发件人信息')}</p>
        </div>

        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          <button
            onClick={() => setActiveTab('model')}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'model'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Cpu size={16} />
            {t('模型设置')}
          </button>
          <button
            onClick={() => setActiveTab('sender')}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'sender'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <User size={16} />
            {t('发件人设置')}
          </button>
          <button
            onClick={() => setActiveTab('robot')}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'robot'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Bot size={16} />
            {t('机器人对接')}
          </button>
          {isAdmin && (
            <button
              onClick={() => setActiveTab('mail')}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'mail'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Mail size={16} />
              {t('发信服务')}
            </button>
          )}
        </div>

        {activeTab === 'model' && (
          <Card>
            <CardContent className="p-5">
              {/* 没配自己的 API Key 时，生成邮件/IM 话术会直接失败。
                  这里提前告知，而不是等用户点了「一键生成」才报错。 */}
              {config && !config.apiKeySet && (
                <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {t('还没有配置 API Key，邮件和 IM 话术都无法生成。填写下面的密钥并保存后即可使用。')}
                </div>
              )}
              <Form {...modelForm}>
                <form
                  onSubmit={modelForm.handleSubmit(onModelSubmit)}
                  className="space-y-5"
                >



                  {/* 模型名称占 2/3、温度占 1/3：一行放得下且主次分明 */}
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-[2fr,1fr]">
                    <FormField
                      control={modelForm.control}
                      name="modelName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('模型名称')}</FormLabel>
                          <FormControl>
                            <select
                              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                              value={field.value ?? ''}
                              onChange={(e) => {
                                field.onChange(e.target.value);
                                // ZCode 式供应商模板：选哪家的模型，就切到那家的官方端点。
                                // 「From your API」组的模型查不到厂商，保留用户现在的地址。
                                const prov = findProviderByModel(e.target.value);
                                if (prov) modelForm.setValue('apiBaseUrl', prov.baseUrl);
                              }}
                            >
                              {/* 当前值不在任何列表里（手填过 / API 下架了）也要能显示 */}
                              {field.value &&
                                !modelGroups.some((g) =>
                                  g.models.some((m) => m.id === field.value),
                                ) && <option value={field.value}>{field.value}</option>}
                              {modelGroups.map((g) => (
                                <optgroup key={g.company} label={g.company}>
                                  {g.models.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.note ? `${m.id} · ${m.note}` : m.id}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={modelForm.control}
                      name="temperature"
                      render={({ field }) => {
                        const val =
                          field.value === null || field.value === undefined
                            ? ''
                            : String(field.value);
                        return (
                          <FormItem>
                            <FormLabel>{t('温度')}</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                max="2"
                                placeholder={t('默认 1')}
                                value={val}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === '') {
                                    field.onChange(null);
                                  } else {
                                    field.onChange(Number(v));
                                  }
                                }}
                                onBlur={field.onBlur}
                                name={field.name}
                                ref={field.ref}
                              />
                            </FormControl>
                            <FormMessage />
                            {/* 推理模型不吃自定义 temperature：说明一下，
                                免得用户以为"设了 0.3 却没生效"是 bug */}
                            {/* 一事一议：不同家族对 temperature/max_tokens 的接受度不同，
                                后端 buildChatBody 会按家族翻译，这里只提示差异 */}
                            {(() => {
                              const m = modelForm.watch('modelName') ?? '';
                              if (isReasoningModel(m)) {
                                return (
                                  <p className="mt-1 break-words text-xs text-slate-500">
                                    {t('推理模型不吃 Temperature：会换算成 reasoning_effort。')}
                                  </p>
                                );
                              }
                              if (detectFamily(m) === 'anthropic') {
                                return (
                                  <p className="mt-1 break-words text-xs text-slate-500">
                                    {t('Claude 的 Temperature 范围是 0~1，超出自动收窄。')}
                                  </p>
                                );
                              }
                              return null;
                            })()}
                          </FormItem>
                        );
                      }}
                    />
                  </div>

                  <FormField
                    control={modelForm.control}
                    name="apiBaseUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>API Base URL</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="https://api.openai.com/v1"
                            {...field}
                          />
                        </FormControl>
                        {/* 选了目录里的模型 → 自动切到那家官方端点；
                            「From your API」组的模型不知道厂商，不动 URL */}
                        {selectedProvider && selectedProvider.baseUrl && (
                          <p className="mt-1 break-words text-xs text-slate-500">
                            {t('已切换到')}{' '}
                            <span className="font-medium text-slate-700">{selectedProvider.company}</span>
                            {t('的官方端点。')}
                            {selectedProvider.apiKeyUrl && (
                              <>
                                {' '}
                                <a href={selectedProvider.apiKeyUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                                  {t('去申请这家')}
                                </a>
                                {' '}{t('的 API Key。')}
                              </>
                            )}
                            {' '}{t('用聚合渠道时手动改回它的地址即可。')}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

<FormField
                    control={modelForm.control}
                    name="apiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>API Key</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder={t('留空则不修改')}
                            {...field}
                            value={field.value ?? ''}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={modelForm.control}
                    name="emailLanguage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('邮件语言')}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={t('选择语言')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="country">{t('跟随对应国家官方语言')}</SelectItem>
                            <SelectItem value="auto">{t('跟随网站语言')}</SelectItem>
                            <SelectItem value="serbian">{t('塞尔维亚语')}</SelectItem>
                            <SelectItem value="english">{t('英语')}</SelectItem>
                            <SelectItem value="chinese">{t('中文')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={modelForm.control}
                    name="senderSignature"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('发件人署名')}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={3}
                            placeholder={t('会出现在邮件结尾')}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {testResult && (
                    <div
                      className={`rounded-md p-3 text-sm border ${
                        testResult.success
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-red-50 text-red-700 border-red-200'
                      }`}
                    >
                      {testResult.success ? '✓ ' : '✗ '}
                      {testResult.message}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button
                      type="submit"
                      variant="default"
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending ? t('保存中...') : t('保存设置')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleTestConnection}
                      disabled={testing}
                    >
                      {testing ? t('测试中...') : t('测试连接')}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {activeTab === 'sender' && (
          <Card>
            <CardContent className="p-5">
              <Form {...senderForm}>
                <form
                  onSubmit={senderForm.handleSubmit(onSenderSubmit)}
                  className="space-y-5"
                >
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <FormField
                      control={senderForm.control}
                      name="senderName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('发件人姓名')}</FormLabel>
                          <FormControl>
                            <Input placeholder="Zijian Lang" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={senderForm.control}
                      name="senderTitle"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('职位 / 头衔')}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Global Sourcing Specialist"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={senderForm.control}
                    name="personalStory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('个人经历 / 背景故事')}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={6}
                            placeholder={t(
                              '用于邮件中增加个人色彩，写得越真诚效果越好。建议写清楚国家/城市/学校/行业经历等。',
                            )}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-700 border border-blue-200">
                    {t(
                      '个人背景会根据对方公司所在国家自适应融入邮件。例如对方是英国公司时，会自然提到英国留学经历；其他国家则不会强行插入。',
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button
                      type="submit"
                      variant="default"
                      disabled={senderUpdateMutation.isPending}
                    >
                      {senderUpdateMutation.isPending
                        ? t('保存中...')
                        : t('保存设置')}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

                {/* 企业微信群机器人：收到客户回复时推提醒 + 自动加星标。
            只放在「Robot integration」标签里。上一次把它移到标签顶部时
            误删了 tab 条件（又变成每页都有）——两个条件缺一不可。 */}
        {isAdmin && activeTab === 'robot' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell size={16} className="text-primary" />
                {t('企业微信提醒')}
              </CardTitle>
              <CardDescription>
                {t('客户回复被后台收取时，往企业微信群推一条提醒，并自动给该公司加星标')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t('群机器人 Webhook 地址')}</Label>
                <Input
                  value={wecom.webhookUrl}
                  onChange={(e) => setWecom({ ...wecom, webhookUrl: e.target.value })}
                  placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                />
                <p className="text-xs text-slate-500">
                  {wecom.webhookSet
                    ? t('已保存，直接改上面的地址即可换新的。')
                    : t(
                        '在企业微信群里「添加群机器人」，弹窗里复制「Webhook 地址」那一整条。它应以 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key= 开头——注意不是浏览器地址栏的网址。',
                      )}
                </p>
              </div>

              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={wecom.enabled}
                    onChange={(e) => setWecom({ ...wecom, enabled: e.target.checked })}
                  />
                  {t('启用回复提醒')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={wecom.autoStarOnReply}
                    onChange={(e) =>
                      setWecom({ ...wecom, autoStarOnReply: e.target.checked })
                    }
                  />
                  {t('收到回复自动加星标')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={wecom.includeSnippet}
                    onChange={(e) => setWecom({ ...wecom, includeSnippet: e.target.checked })}
                  />
                  {t('提醒里带正文摘要')}
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={wecomBusy}
                  onClick={async () => {
                    setWecomBusy(true);
                    try {
                      await adminApi.saveWecomNotifyConfig({
                        webhookUrl: wecom.webhookUrl || undefined,
                        enabled: wecom.enabled,
                        autoStarOnReply: wecom.autoStarOnReply,
                        includeSnippet: wecom.includeSnippet,
                      });
                      // 已保存的地址继续显示，别清空（清空像被删了）
                      setWecom((prev) => ({ ...prev, webhookSet: true }));
                      toast.success(t('企业微信提醒已保存'));
                    } catch (err: unknown) {
                      toast.error(t('保存失败'), {
                        description: err instanceof Error ? err.message : String(err),
                      });
                    } finally {
                      setWecomBusy(false);
                    }
                  }}
                >
                  {wecomBusy ? t('保存中...') : t('保存')}
                </Button>
                <Button
                  variant="outline"
                  disabled={wecomBusy || !(wecom.webhookSet || wecom.webhookUrl.trim())}
                  onClick={async () => {
                    setWecomBusy(true);
                    try {
                      const r = await adminApi.testWecomNotify(
                        wecom.webhookUrl.trim() || undefined,
                      );
                      if (r.ok) toast.success(t('推送成功'), { description: r.message });
                      else toast.error(t('推送失败'), { description: r.message });
                    } catch (err: unknown) {
                      toast.error(t('推送失败'), {
                        description: err instanceof Error ? err.message : String(err),
                      });
                    } finally {
                      setWecomBusy(false);
                    }
                  }}
                >
                  {t('测试推送')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

{activeTab === 'robot' && (
          <div className="space-y-6">
            <Card>
              <CardContent className="p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">
                      {t('导入密钥')}
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                      {t('机器人调用自动导入接口时需携带此密钥，泄露后请立即更换')}
                    </p>
                  </div>
                  <KeyRound size={20} className="text-slate-400" />
                </div>

                {secretLoading ? (
                  <p className="text-sm text-slate-400">{t('加载中...')}</p>
                ) : importSecretData?.importSecretSet ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700">
                        {importSecretData.importSecretMasked || '••••••••••••••••'}
                      </div>
                      <p className="text-xs text-slate-500">
                        {t('密钥已设置，前端不明文回显')}
                      </p>
                    </div>
                    <p className="text-xs text-slate-500">
                      {t('当前密钥已设置。如需更换，请在下方输入新密钥并保存。')}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
                    {t('尚未设置导入密钥，机器人无法调用自动导入接口。')}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    {t('新密钥')}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder={t('输入或生成 32 位密钥')}
                      value={secretInput}
                      onChange={(e) => setSecretInput(e.target.value)}
                    />
                    <Button variant="outline" onClick={generateSecret}>
                      {t('随机生成')}
                    </Button>
                  </div>
                </div>

                <Button
                  onClick={saveSecret}
                  disabled={savingSecret || !secretInput.trim()}
                >
                  {savingSecret ? t('保存中...') : t('保存密钥')}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5 space-y-5">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">
                    {t('机器人对接说明')}
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    {t('将以下信息配置给豆包机器人，扒完地图后自动导入并返回项目链接')}
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      {t('接口地址')}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-md bg-slate-100 px-3 py-2 text-xs font-mono text-slate-700 break-all">
                        POST {resolveAppUrl('/openapi/auto-import/leads')}
                      </code>
                      <Button variant="outline" size="sm" onClick={copyRobotEndpoint}>
                        <Copy size={14} />
                        {t('复制')}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      {t('请求头')}
                    </p>
                    <div className="rounded-md bg-slate-100 p-3">
                      <p className="text-xs font-mono text-slate-700">
                        X-Import-Secret: &lt;{t('你的导入密钥')}&gt;
                      </p>
                      <p className="text-xs font-mono text-slate-700 mt-1">
                        Content-Type: application/json
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      {t('请求体示例')}
                    </p>
                    <pre className="rounded-md bg-slate-900 p-3 text-xs text-slate-100 overflow-x-auto leading-relaxed">
  {`{
    "projectName": "塞尔维亚餐厅拓展",
    "leads": [
      {
        "序号": 1,
        "名称": "Restaurant Aurora",
        "国家/地区": "Serbia",
        "地址": "Knez Mihailova 1, Belgrade",
        "网站": "https://aurora.rs",
        "电话": "+381 11 123 4567",
        "邮箱": "info@aurora.rs",
        "核验状态": "Verified",
        "来源": "https://maps.google.com/...",
        "纬度": 44.7866,
        "经度": 20.4489
      }
    ]
  }`}
                    </pre>
                    <p className="text-xs text-slate-500 mt-2">
                      {t(
                        '字段支持中文表头（如上）和英文表头（Name, Country, Address, Website, Phone, Email, Verification, Source, Lat, Lng）混合。',
                      )}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      {t('返回示例')}
                    </p>
                    <pre className="rounded-md bg-slate-900 p-3 text-xs text-slate-100 overflow-x-auto leading-relaxed">
  {`{
    "projectId": "ff357fb6-009c-...",
    "projectUrl": "/projects/ff357fb6-009c-...",
    "imported": 48,
    "duplicates": 2
  }`}
                    </pre>
                    <p className="text-xs text-slate-500 mt-2">
                      <strong>projectUrl</strong>：{t('把这个链接发给用户，点击直接进入该项目工作台。')}
                      {' '}
                      {t('还可以加上')} <code className="bg-slate-100 px-1 rounded">?lead=&lt;{t('线索id')}&gt;&action=generate</code> {t('来定位单条线索并自动生成邮件。')}
                    </p>
                  </div>

                  <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
                    <p className="text-sm text-blue-700 font-medium">{t('使用流程')}</p>
                    <ol className="text-xs text-blue-700 mt-2 space-y-1 list-decimal list-inside">
                      <li>{t('机器人扒完地图后，将数据整理为 JSON')}</li>
                      <li>{t('POST 到上方接口（带上 X-Import-Secret 请求头）')}</li>
                      <li>{t('接口返回 projectUrl，机器人把链接发给你')}</li>
                      <li>{t('点开链接直接进入项目工作台，查看已导入的线索')}</li>
                      <li>{t('一键批量生成邮件，或点击单条查看详情')}</li>
                    </ol>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {isAdmin && activeTab === 'mail' && (
          <Card>
            <CardContent className="space-y-4">
              {/* 邮箱后台：先列有哪些邮箱可用，点进去编辑，右上角添加 */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-800">{t('发信邮箱')}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {t('点下面的邮箱可以进行编辑或删除；发送时在「一键发送」旁选择用哪个。')}
                    </p>
                    {/* 默认邮箱：不选账号时收发都用它。之前只能靠列表里的「默认」小标，
                        用户找不到"在哪设置默认"——这里直接写出来。 */}
                    {/* 默认收发邮箱：直接一个下拉选，不用展开某个邮箱再点按钮 */}
                    {defaultAccount && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        <span className="font-semibold text-slate-800">{t('默认邮箱')}</span>
                        <select
                          className="flex h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                          value={defaultAccount.id}
                          disabled={accountBusy}
                          onChange={(e) => void handleSetDefaultAccount(e.target.value)}
                        >
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.email}
                            </option>
                          ))}
                        </select>
                        <span className="text-slate-400">
                          {t('（不选账号时，收发都用这个；后台收取也读它的 IMAP 配置）')}
                        </span>
                      </p>
                    )}
                  </div>
                  <Button size="sm" onClick={openNewAccount} disabled={accountBusy}>
                    <Plus size={14} className="mr-1" />
                    {t('添加邮箱')}
                  </Button>
                </div>

                {accountsLoading ? (
                  <p className="mt-4 text-sm text-slate-400">{t('正在读取邮箱...')}</p>
                ) : accountsError ? (
                  <div className="mt-4 rounded-md bg-red-50 px-3 py-3 text-sm text-red-800">
                    <p className="font-medium">{t('邮箱列表加载失败，不是没有邮箱。')}</p>
                    <p className="mt-1 break-all text-xs text-red-700">{accountsError}</p>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => void refreshAccounts()}>
                      {t('重试')}
                    </Button>
                  </div>
                ) : accounts.length === 0 && editingAccount === null ? (
                  <p className="mt-4 rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    {t('还没有可用邮箱。点右上角「添加邮箱」添加第一个；未添加时发送会沿用下面的旧配置。')}
                  </p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {accounts.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() =>
                            editingAccount === a.id
                              ? setEditingAccount(null)
                              : openAccountEditor(a)
                          }
                          className={`flex w-full flex-wrap items-center gap-2 rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                            editingAccount === a.id
                              ? 'border-blue-300 bg-blue-50'
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <Mail size={15} className="text-slate-400" />
                          <span className="font-medium text-slate-800">{a.email}</span>
                          {a.isDefault && (
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                              {t('默认')}
                            </span>
                          )}
                          <span className="text-xs text-slate-400">
                            {a.host}:{a.port}
                            {a.secure ? ` ${t('SSL')}` : ''}
                          </span>
                          <span className="ml-auto text-xs text-slate-400">
                            {editingAccount === a.id ? t('收起') : t('编辑')}
                          </span>
                        </button>

                        {/* 展开：编辑表单 */}
                        {editingAccount === a.id && (
                          <div className="mt-2 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-1">
                                <Label htmlFor={`acc-email-${a.id}`}>{t('发件邮箱')}</Label>
                                <Input
                                  id={`acc-email-${a.id}`}
                                  value={accountForm.email}
                                  onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value })}
                                  placeholder="name@company.com"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`acc-pwd-${a.id}`}>{t('授权码 / 密码')}</Label>
                                <Input
                                  id={`acc-pwd-${a.id}`}
                                  value={accountForm.password}
                                  onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`acc-host-${a.id}`}>{t('SMTP 服务器')}</Label>
                                <Input
                                  id={`acc-host-${a.id}`}
                                  value={accountForm.host}
                                  onChange={(e) => setAccountForm({ ...accountForm, host: e.target.value })}
                                  placeholder="smtp.exmail.qq.com"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`acc-port-${a.id}`}>{t('端口')}</Label>
                                <Input
                                  id={`acc-port-${a.id}`}
                                  value={accountForm.port}
                                  onChange={(e) => setAccountForm({ ...accountForm, port: e.target.value })}
                                  placeholder="465"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`acc-name-${a.id}`}>{t('发件人显示名（可选）')}</Label>
                                <Input
                                  id={`acc-name-${a.id}`}
                                  value={accountForm.fromName}
                                  onChange={(e) => setAccountForm({ ...accountForm, fromName: e.target.value })}
                                />
                              </div>
                              <div className="flex items-end gap-3">
                                <label className="flex items-center gap-2 text-sm text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={accountForm.secure}
                                    onChange={(e) => setAccountForm({ ...accountForm, secure: e.target.checked })}
                                  />
                                  {t('SSL')}
                                </label>
                              </div>
                            <div className="md:col-span-2 space-y-3 rounded-md border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-slate-700">{t('收件（IMAP）')}</h4>
                                <label className="flex items-center gap-2 text-sm text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={accountForm.inboxPollEnabled}
                                    onChange={(e) =>
                                      setAccountForm({ ...accountForm, inboxPollEnabled: e.target.checked })
                                    }
                                  />
                                  {t('后台自动收取')}
                                </label>
                              </div>
                              <div className="grid gap-3 md:grid-cols-3">
                                <div className="space-y-1">
                                  <Label htmlFor="edit-imap-host">{t('IMAP 服务器')}</Label>
                                  <Input
                                    id="edit-imap-host"
                                    value={accountForm.imapHost}
                                    onChange={(e) => setAccountForm({ ...accountForm, imapHost: e.target.value })}
                                    placeholder="imap.exmail.qq.com"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor="edit-imap-port">{t('端口')}</Label>
                                  <Input
                                    id="edit-imap-port"
                                    value={accountForm.imapPort}
                                    onChange={(e) => setAccountForm({ ...accountForm, imapPort: e.target.value })}
                                    placeholder="993"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor="edit-imap-secs">{t('轮询间隔（秒）')}</Label>
                                  <Input
                                    id="edit-imap-secs"
                                    value={accountForm.inboxPollSeconds}
                                    onChange={(e) => setAccountForm({ ...accountForm, inboxPollSeconds: e.target.value })}
                                    placeholder="180"
                                  />
                                </div>
                              </div>
                              <label className="flex items-center gap-2 text-sm text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={accountForm.imapSecure}
                                  onChange={(e) => setAccountForm({ ...accountForm, imapSecure: e.target.checked })}
                                />
                                {t('IMAP SSL')}
                              </label>
                            </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button size="sm" disabled={accountBusy} onClick={() => void handleSaveAccount()}>
                                {accountBusy ? <Loader2 className="mr-1 animate-spin" size={14} /> : null}
                                {t('保存')}
                              </Button>
                              {!a.isDefault && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={accountBusy}
                                  onClick={() => void handleSetDefaultAccount(a.id)}
                                >
                                  {t('设为默认收发邮箱')}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-500 hover:bg-red-50 hover:text-red-600"
                                disabled={accountBusy}
                                onClick={() => void handleDeleteAccount(a.id, a.email)}
                              >
                                {t('删除这个邮箱')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="ml-auto"
                                onClick={() => setEditingAccount(null)}
                              >
                                {t('取消')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {/* 新建表单：点「添加邮箱」才出现 */}
                {editingAccount === 'new' && (
                  <div className="mt-4 space-y-3 rounded-md border border-blue-200 bg-blue-50/40 p-3">
                    <h3 className="text-sm font-semibold text-slate-800">{t('新邮箱')}</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="acc-email-new">{t('发件邮箱')}</Label>
                        <Input
                          id="acc-email-new"
                          value={accountForm.email}
                          onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value })}
                          placeholder="name@company.com"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="acc-pwd-new">{t('授权码 / 密码')}</Label>
                        <Input
                          id="acc-pwd-new"
                          value={accountForm.password}
                          onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="acc-host-new">{t('SMTP 服务器')}</Label>
                        <Input
                          id="acc-host-new"
                          value={accountForm.host}
                          onChange={(e) => setAccountForm({ ...accountForm, host: e.target.value })}
                          placeholder="smtp.exmail.qq.com"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="acc-port-new">{t('端口')}</Label>
                        <Input
                          id="acc-port-new"
                          value={accountForm.port}
                          onChange={(e) => setAccountForm({ ...accountForm, port: e.target.value })}
                          placeholder="465"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="acc-name-new">{t('发件人显示名（可选）')}</Label>
                        <Input
                          id="acc-name-new"
                          value={accountForm.fromName}
                          onChange={(e) => setAccountForm({ ...accountForm, fromName: e.target.value })}
                        />
                      </div>
                      <div className="flex items-end gap-3">
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                          <input
                            type="checkbox"
                            checked={accountForm.secure}
                            onChange={(e) => setAccountForm({ ...accountForm, secure: e.target.checked })}
                          />
                          {t('SSL')}
                        </label>
                      </div>
                            <div className="md:col-span-2 space-y-3 rounded-md border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-slate-700">{t('收件（IMAP）')}</h4>
                                <label className="flex items-center gap-2 text-sm text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={accountForm.inboxPollEnabled}
                                    onChange={(e) =>
                                      setAccountForm({ ...accountForm, inboxPollEnabled: e.target.checked })
                                    }
                                  />
                                  {t('后台自动收取')}
                                </label>
                              </div>
                              <div className="grid gap-3 md:grid-cols-3">
                                <div className="space-y-1">
                                  <Label htmlFor="new-imap-host">{t('IMAP 服务器')}</Label>
                                  <Input
                                    id="new-imap-host"
                                    value={accountForm.imapHost}
                                    onChange={(e) => setAccountForm({ ...accountForm, imapHost: e.target.value })}
                                    placeholder="imap.exmail.qq.com"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor="new-imap-port">{t('端口')}</Label>
                                  <Input
                                    id="new-imap-port"
                                    value={accountForm.imapPort}
                                    onChange={(e) => setAccountForm({ ...accountForm, imapPort: e.target.value })}
                                    placeholder="993"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor="new-imap-secs">{t('轮询间隔（秒）')}</Label>
                                  <Input
                                    id="new-imap-secs"
                                    value={accountForm.inboxPollSeconds}
                                    onChange={(e) => setAccountForm({ ...accountForm, inboxPollSeconds: e.target.value })}
                                    placeholder="180"
                                  />
                                </div>
                              </div>
                              <label className="flex items-center gap-2 text-sm text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={accountForm.imapSecure}
                                  onChange={(e) => setAccountForm({ ...accountForm, imapSecure: e.target.checked })}
                                />
                                {t('IMAP SSL')}
                              </label>
                            </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" disabled={accountBusy} onClick={() => void handleSaveAccount()}>
                        {accountBusy ? <Loader2 className="mr-1 animate-spin" size={14} /> : null}
                        {t('保存')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingAccount(null)}>
                        {t('取消')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* 全局的「发信服务 / 收件服务」两块（连同它们的保存/测试邮件按钮）
                 已全部移除：所有配置跟着邮箱走，点上面的邮箱展开编辑即可设置 SMTP 与 IMAP。 */}
            </CardContent>
          </Card>
        )}

      </div></>
);
};

export default SettingsPage;
