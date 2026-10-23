/**
 * 服务端错误信息的界面语言翻译。
 *
 * 为什么在拦截器做：服务端（NestJS）的报错文案全是中文，而错误在每个调用点
 * 都是用 `err.message` 直接展示的（20+ 处）。逐个调用点套 t() 不现实，
 * 在 axios 响应拦截器里把 error.message 改写成当前界面语言，所有调用点自动受益。
 *
 * 只翻译「用户能自己采取行动」的高频错误；低频/开发向的保持原文，
 * 免得翻译错关键字掩盖了真实原因。
 */

// 界面语言存在 localStorage（i18n/index.tsx 同款 key），拦截器不在 React 树内，直接读
function currentLang(): 'zh' | 'en' {
  try {
    return window.localStorage.getItem('bd-mail-ui-lang') === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

/** 中文服务端报错 → 英文。key 用包含判断的精确匹配（服务端消息是固定文案） */
const SERVER_MESSAGES_EN: Record<string, string> = {
  '请先在设置中配置你的 API Key':
    'No API Key configured yet. Open Settings → Model settings, fill in your key and save.',
  '缺少项目 ID': 'Missing project ID.',
  '缺少文件内容': 'Missing file content.',
  '文件内容格式错误，无法解析 base64': 'The file content is not valid base64.',
  '文件内容为空': 'The uploaded file is empty.',
  '文件大小超过 30MB 限制': 'The file exceeds the 30MB limit.',
  '未上传文件，请选择 Excel 文件后重试': 'No file uploaded. Choose an Excel file and try again.',
  '邮箱、授权码/密码、SMTP 服务器都不能为空':
    'Mailbox, auth code / password and SMTP server are all required.',
  '发信账号不存在或无权修改': 'That mailbox does not exist or you cannot modify it.',
  '不能修改自己的角色': 'You cannot change your own role.',
  '不能修改超级管理员的角色': 'The super admin account cannot be modified here.',
  '需要超级管理员权限': 'This action requires super admin permission.',
  '角色值无效': 'Invalid role value.',
  '用户不存在': 'User not found.',
  '密码至少 8 位，且必须包含字母和数字':
    'Password must be at least 8 characters and include both letters and numbers.',
  '该邮箱已被注册': 'That email is already registered.',
  '邮箱或密码错误': 'Incorrect email or password.',
  '账号已被停用': 'This account has been disabled. Contact your administrator.',
  '电话号码无法格式化为国际号码':
    'The phone number could not be formatted as an international number. Check the country column.',
  '模型返回内容为空': 'The model returned an empty response. Try again.',
  '模型不支持图片输入（已知）':
    'This model does not support image input (known limitation).',
  '生成失败，请稍后重试': 'Generation failed. Please try again later.',
  '发送失败': 'Sending failed.',
  '删除失败': 'Delete failed.',
  '保存失败': 'Save failed.',
  '导入失败': 'Import failed.',
};

/** 拦截器里能拿到的是 axios error；把响应体里的中文报错换掉 */
function translateAxiosError(err: unknown): unknown {
  if (currentLang() !== 'en') return err;
  const e = err as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string; isAxiosError?: boolean } | null;
  if (!e || !e.isAxiosError) return err;
  const apiMessage = e.response?.data?.error?.message ?? e.response?.data?.message;
  if (typeof apiMessage === 'string') {
    const hit = SERVER_MESSAGES_EN[apiMessage.trim()];
    if (hit) {
      // 同步替换响应体和 axios message：两种读取路径都会拿到英文
      if (e.response?.data?.error) e.response.data.error.message = hit;
      else if (e.response?.data) (e.response.data as { message?: string }).message = hit;
      e.message = hit;
    }
  }
  return err;
}

export function setupErrorTranslation(axiosInstance: {
  interceptors: { response: { use: (onFulfilled: unknown, onRejected: unknown) => void } };
}): void {
  axiosInstance.interceptors.response.use(
    (response) => response,
    (error: unknown) => Promise.reject(translateAxiosError(error)),
  );
}

export { SERVER_MESSAGES_EN };
