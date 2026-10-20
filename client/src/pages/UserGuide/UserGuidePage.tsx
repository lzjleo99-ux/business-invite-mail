import React from 'react';
import {
  FolderKanban,
  Play,
  Mail,
  MessageCircle,
  Send,
  Inbox,
  Settings,
  Star,
  Globe,
} from 'lucide-react';
import { useI18n } from '@client/src/i18n';

interface Section {
  id: string;
  icon: React.FC<{ size?: number | string; className?: string }>;
  title: string;
  steps: string[];
  tips?: string[];
  shot: string;
  shotCaption: string;
}

/** 说明内容里不要用 markdown 星号：本页是纯文本渲染，* 会原样显示 */
const SECTIONS: Section[] = [
  {
    id: 'import',
    icon: FolderKanban,
    title: '一、导入名单',
    steps: [
      '点左侧「项目列表」，右上角「新建项目」，给这批客户起个名字（如「塞尔维亚鸡场」）。',
      '进入项目的「工作台」，点「导入名单」，上传 Excel。',
      '表头固定 11 列，按模板填即可：序号 / 公司名称 / 国家 / 地址 / 官网 / 电话 / 邮箱 / 备注等。',
      '导入后「总数量」立刻变化，可以在顶部统计卡里点任意一张卡直接筛选对应公司。',
    ],
    tips: ['没有官网的公司也能导入，只是后面无法自动分析网站。'],
    shot: '/guide/01-project-list.png',
    shotCaption: '项目列表：每个项目是一条独立的客户批次',
  },
  {
    id: 'analyze',
    icon: Globe,
    title: '二、一键分析全部',
    steps: [
      '点「一键分析全部」，系统会逐个访问公司官网。',
      '分析内容：抓邮箱、抓电话、抓业务类型，整理公司背景摘要。',
      '已抓到邮箱的公司不会被清空；官网出现更优邮箱才会替换。',
      '分析结束后「已分析」上涨，「待分析」归零。',
    ],
    tips: [
      '失败的会在「失败」卡里，展开行能看到失败原因。',
      '「已分析」包含「生成中 / 已生成」两种后续状态。',
    ],
    shot: '/guide/02-workbench.png',
    shotCaption: '工作台：顶部统计卡可点击筛选，下方是公司列表',
  },
  {
    id: 'generate',
    icon: Mail,
    title: '三、一键生成邮件',
    steps: [
      '点「一键生成全部」，只为「已分析 + 有邮箱 + 还没生成」的公司生成（无邮箱的不生成，纯烧额度）。',
      '每封同时产出两个版本：英文版 + 客户母语版（如塞尔维亚语），收件人母语版转化率更高。',
      'AI 推理模型较慢，一封可能要几十秒到几分钟，进度条会显示进度。',
      '展开任意一行 →「邮件内容」tab 可以预览、编辑、重新生成。',
    ],
    tips: [
      '「语言：本地语言 / English」切换看的是哪一版；你看到哪版，发送时就发哪版。',
      '如果某家生成失败，状态会自动回到「已分析」，可以直接重试。',
    ],
    shot: '/guide/03-company-detail.png',
    shotCaption: '展开行 →「邮件内容」：预览、编辑、重新生成、语言切换',
  },
  {
    id: 'whatsapp',
    icon: MessageCircle,
    title: '四、一键准备 IM 话术',
    steps: [
      '点「一键准备 IM 话术」，为有电话号码的公司生成 WhatsApp / Viber 开场话术。',
      '话术同样产出两个版本，右侧下拉选「本地语言 / English」决定哪一版作为该公司的当前话术。',
      '生成后在展开行「即时消息」tab 可以预览、复制、按渠道分别发。',
    ],
    tips: ['没有可用号码的公司会被自动跳过。'],
    shot: '/guide/02-workbench.png',
    shotCaption: '「一键准备 IM 话术」及其右侧的语言下拉',
  },
  {
    id: 'send',
    icon: Send,
    title: '五、一键发送',
    steps: [
      '点「一键发送」，系统挑出「从未联系过」的公司逐家经 SMTP 真实发出。',
      '判定「已联系」= 成功发过，或收到过回复，或你手动标记过。',
      '发送失败的不算「已联系」，可以再批量重试一次。',
      '右侧下拉选发送语言；发送前有确认弹窗，会再显示一次语言版本。',
      '发出的内容与你展开行预览的完全一致（所见即所发）。',
    ],
    tips: [
      '这是真实外发，点之前请确认文案没问题。',
      '发送失败的记录会以红色「发送失败」留在往来记录里，点开可看 SMTP 报错原因。',
      '退信（Undeliverable）会以「收到回复」形式进来，因此也算已联系、不会重复发；'
        + '这类公司需要你手动换地址后再发。',
    ],
    shot: '/guide/04-history-detail.png',
    shotCaption: '发送后的往来记录：点开可看完整正文与失败原因',
  },
  {
    id: 'history',
    icon: Inbox,
    title: '六、往来记录与回复提醒',
    steps: [
      '发信和收信都会自动留痕，公司行展开后底部「往来记录」能看到全部往来。',
      '点任意一条往来记录可看完整信息：类型、时间、收发件人、完整正文、Message-ID。',
      '左侧「邮件往来」页可看全项目的往来，支持按方向 / 状态 / 公司 / 邮箱 / 主题搜索。',
      '系统后台每 3 分钟自动收一次收件箱；客户回复会自动入库。',
      '收到回复后该公司会自动加星标（可在统计卡「星标企业」里筛出来）。',
      '还可以在「设置」里配置企业微信群机器人，收到回复时推一条提醒到你的企微群。',
    ],
    tips: [
      '同一封邮件按 Message-ID 去重，不会重复入库。',
      '「已发送 / 发送失败 / 收到回复」三种状态在列表上有颜色区分。',
    ],
    shot: '/guide/05-email-history.png',
    shotCaption: '左侧「邮件往来」：全项目往来记录，可搜索筛选',
  },
  {
    id: 'settings',
    icon: Settings,
    title: '七、设置（发信服务与通知）',
    steps: [
      '「发信服务」：填 SMTP（腾讯企业邮箱 smtp.exmail.qq.com / 465 / SSL），密码填授权码不是登录密码。',
      'IMAP 收信用同一套账号密码，IMAP 主机一般就是 imap.exmail.qq.com:993。',
      '打开「后台自动收取」并设间隔（建议 180 秒），可点「立即收取一次」手动触发。',
      '「企业微信提醒」：填群机器人 webhook → 打开「启用回复提醒」→ 点「测试推送」确认能收到。',
      '「收到回复自动加星标」默认开启，不需要额外配置。',
    ],
    tips: [
      '发信服务未配置时，生成邮件仍可用，但「一键发送」会失败。',
      'webhook 地址属于敏感信息，保存后系统只显示「是否已设置」，不再回显原文。',
    ],
    shot: '/guide/06-settings.png',
    shotCaption: '设置页：发信服务、IMAP 自动收取、企微提醒',
  },
  {
    id: 'star',
    icon: Star,
    title: '八、跟进与标记',
    steps: [
      '点公司名前面的 ☆ 可以手动加星 / 取消星标，重要客户一眼找到。',
      '收到客户回复会自动加星，不需要手动操作。',
      '顶部「星标企业」卡点一下就只看星标客户。',
      '展开行「联系状态」可以手动标记已邮件联系 / WhatsApp 已联系 / Viber 已联系。',
    ],
    tips: ['手动标记「已邮件联系」后，一键发送会跳过该公司，不会重复打扰。'],
    shot: '/guide/02-workbench.png',
    shotCaption: '星标：公司名前的 ☆ 图标',
  },
  {
    id: 'firstuse',
    icon: Play,
    title: '九、第一次使用的推荐顺序',
    steps: [
      '① 设置 → 配好发信服务（并测一次「立即收取」）。',
      '② 项目列表 → 新建项目 → 导入名单。',
      '③ 工作台 → 一键分析全部（等它跑完）。',
      '④ 抽查几封「一键生成全部」生成的邮件，必要时编辑。',
      '⑤ 一键准备 IM 话术。',
      '⑥ 一键发送（确认语言版本）。',
      '⑦ 之后每天只需看「邮件往来」和「星标企业」，有新回复会自动提醒。',
    ],
    tips: ['整条链路大约是：导入 → 分析 → 生成 → 发送 → 收回复，顺序不要跳。'],
    shot: '/guide/02-workbench.png',
    shotCaption: '工作台顶部的四个批量按钮就是主流程',
  },
];

const UserGuidePage: React.FC = () => {
  const { t, lang } = useI18n();
  const [active, setActive] = React.useState(SECTIONS[0].id);

  /**
   * 截图按语言分文件：中文用 xxx.png，英文用 xxx-en.png。
   * 之前只有一套中文截图，切英文时文字变了、图还是中文的，看起来像没切换。
   * 英文图缺失时回退中文图（保证不出现破图）。
   */
  /**
   * 截图地址按语言切换；`?v=` 是缓存击穿版本号。
   * 截图文件名不带内容哈希，浏览器会一直用旧缓存——曾经就因为换过图片内容
   * 但 URL 没变，用户看到的还是上一版（表现为"改了没生效"）。
   * 以后每次替换截图文件，把这个数字 +1。
   */
  const SHOT_VERSION = '3';
  const shotFor = (shot: string): string => {
    const base = lang === 'en' && shot.endsWith('.png') ? shot.replace(/\.png$/, '-en.png') : shot;
    return `${base}?v=${SHOT_VERSION}`;
  };

  /** 顶部章节按钮：跳到对应章节并高亮 */
  const jumpTo = (id: string) => {
    setActive(id);
    const el = document.getElementById(`guide-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t('使用说明')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('从导入名单到收回复的完整流程，按步骤分类说明。所有截图取自真实系统。')}
        </p>
      </div>

      {/* 顶部章节导航：点击跳转到对应章节 */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jumpTo(s.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              active === s.id
                ? 'bg-primary text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {t(s.title)}
          </button>
        ))}
      </div>

      {/* 全部章节正文：一次性铺开，不再折叠 */}
      <div className="space-y-8">
        {SECTIONS.map((s) => (
          <section
            key={s.id}
            id={`guide-${s.id}`}
            className="scroll-mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-5"
          >
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
              <s.icon size={18} className="text-primary" />
              {t(s.title)}
            </h2>

            <ol className="space-y-2 text-sm text-slate-700">
              {s.steps.map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                    {i + 1}
                  </span>
                  <span>{t(step)}</span>
                </li>
              ))}
            </ol>

            {s.tips && s.tips.length > 0 && (
              <div className="rounded-md bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800">{t('注意')}</p>
                <ul className="mt-1 space-y-1 text-xs text-amber-800">
                  {s.tips.map((tip, i) => (
                    <li key={i}>· {t(tip)}</li>
                  ))}
                </ul>
              </div>
            )}

            <figure className="space-y-2 pt-1">
              <img
                src={shotFor(s.shot)}
                alt={t(s.shotCaption)}
                className="w-full rounded-lg border border-slate-200 bg-white shadow-sm"
              />
              <figcaption className="text-xs text-slate-500">{t(s.shotCaption)}</figcaption>
            </figure>
          </section>
        ))}
      </div>
    </div>
  );
};

export default UserGuidePage;
