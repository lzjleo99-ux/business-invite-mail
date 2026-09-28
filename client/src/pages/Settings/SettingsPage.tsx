import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Cpu, User, Bot, Copy, KeyRound } from 'lucide-react';
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
import { Card, CardContent } from '@/components/ui/card';
import * as modelConfigApi from '@/api/model-config';
import * as senderConfigApi from '@/api/sender-config';
import { useI18n } from '@/i18n';
import type {
  ModelConfig,
  SenderConfig,
  UpdateSenderConfigRequest,
} from '@shared/api.interface';

const SettingsPage = () => {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'model' | 'sender' | 'robot'>('model');
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
      const result = await modelConfigApi.testConnection();
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
        </div>

        {activeTab === 'model' && (
          <Card>
            <CardContent className="p-5">
              <Form {...modelForm}>
                <form
                  onSubmit={modelForm.handleSubmit(onModelSubmit)}
                  className="space-y-5"
                >
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

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <FormField
                      control={modelForm.control}
                      name="modelName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('模型名称')}</FormLabel>
                          <FormControl>
                            <Input placeholder="gpt-4o-mini" {...field} />
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
                          </FormItem>
                        );
                      }}
                    />
                  </div>

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
      </div>
</>
);
};

export default SettingsPage;
