/**
 * 国家归一化 + 国旗。
 *
 * 为什么需要：导入名单时「国家」列是用户手填/从不同来源拼来的，同一个国家会出现
 * 多种写法——`Serbia` / `serbia` / `Srbija` / `Србија` / `塞尔维亚`。
 * 如果直接 group by 原文，筛选下拉会出现五条"其实是同一个国家"的选项，统计也会被拆开。
 *
 * 这里的做法：给每个国家一个**规范名**（英文常用名）+ 别名表（英文/本地语/中文/常见拼写变体），
 * 导入时和筛选时都先 canonicalize 再比较。
 */

export interface CountryEntry {
  /** 规范名：筛选值、分组 key、界面显示都用它 */
  canonical: string;
  /** 国旗 emoji */
  flag: string;
  /** 会归并到本国的所有写法（小写比较，含常见拼写变体与本地语言名） */
  aliases: string[];
}

const C = (
  canonical: string,
  flag: string,
  aliases: string[],
): CountryEntry => ({ canonical, flag, aliases });

/** 覆盖本业务实际会碰到的市场（欧洲为主 + 常见贸易伙伴），
 *  查不到的国家会原样返回，不会丢数据。 */
export const COUNTRIES: CountryEntry[] = [
  // —— 巴尔干 / 东欧（本项目主力市场）——
  C('Serbia', '🇷🇸', ['serbia', 'srbija', 'република србија', 'србија', '塞尔维亚', '塞爾維亞', 'republic of serbia']),
  C('Montenegro', '🇲🇪', ['montenegro', 'crna gora', 'црна гора', '黑山']),
  C('Croatia', '🇭🇷', ['croatia', 'hrvatska', 'хрватска', '克罗地亚', '克羅埃西亞', 'republic of croatia']),
  C('Bosnia and Herzegovina', '🇧🇦', ['bosnia and herzegovina', 'bosna i hercegovina', 'босна и херцеговина', 'bosnia', '波黑', '波斯尼亚和黑塞哥维那', '波士尼亞']),
  C('North Macedonia', '🇲🇰', ['north macedonia', 'macedonia', 'severna makedonija', 'македонија', '北马其顿', '馬其頓', 'fyrom']),
  C('Slovenia', '🇸🇮', ['slovenia', 'slovenija', 'словенија', '斯洛文尼亚', '斯洛維尼亞']),
  C('Albania', '🇦🇱', ['albania', 'shqipëria', 'shqiperia', 'албания', '阿尔巴尼亚', '阿爾巴尼亞']),
  C('Kosovo', '🇽🇰', ['kosovo', 'kosovo*', 'косово', '科索沃']),
  C('Bulgaria', '🇧🇬', ['bulgaria', 'bǎlgarija', 'balgariya', 'българия', '保加利亚', '保加利亞']),
  C('Romania', '🇷🇴', ['romania', 'românia', 'romania ', 'румыния', '罗马尼亚', '羅馬尼亞']),
  C('Greece', '🇬🇷', ['greece', 'hellas', 'ελλάδα', 'эллада', '希腊', '希臘']),
  C('Hungary', '🇭🇺', ['hungary', 'magyarország', 'венгрия', '匈牙利']),
  C('Poland', '🇵🇱', ['poland', 'polska', 'польша', '波兰', '波蘭']),
  C('Czechia', '🇨🇿', ['czechia', 'czech republic', 'česko', 'cesko', 'чехия', '捷克']),
  C('Slovakia', '🇸🇰', ['slovakia', 'slovensko', 'словакия', '斯洛伐克']),
  C('Austria', '🇦🇹', ['austria', 'österreich', 'osterreich', 'австрия', '奥地利', '奧地利']),
  C('Germany', '🇩🇪', ['germany', 'deutschland', 'германия', '德国', '德國']),
  C('Switzerland', '🇨🇭', ['switzerland', 'schweiz', 'suisse', 'швейцария', '瑞士']),
  C('Italy', '🇮🇹', ['italy', 'italia', 'италия', '意大利']),
  C('France', '🇫🇷', ['france', 'франция', '法国']),
  C('Spain', '🇪🇸', ['spain', 'españa', 'espana', 'испания', '西班牙']),
  C('Portugal', '🇵🇹', ['portugal', 'португалия', '葡萄牙']),
  C('Netherlands', '🇳🇱', ['netherlands', 'nederland', 'holland', 'нидерланды', '荷兰', '荷蘭']),
  C('Belgium', '🇧🇪', ['belgium', 'belgië', 'belgie', 'бельгия', '比利时', '比利時']),
  C('United Kingdom', '🇬🇧', ['united kingdom', 'uk', 'great britain', 'britain', 'england', 'великобритания', '英国', '英國']),
  C('Ireland', '🇮🇪', ['ireland', 'éire', 'eire', 'ирландия', '爱尔兰', '愛爾蘭']),
  C('Denmark', '🇩🇰', ['denmark', 'danmark', 'дания', '丹麦', '丹麥']),
  C('Sweden', '🇸🇪', ['sweden', 'sverige', 'швеция', '瑞典']),
  C('Norway', '🇳🇴', ['norway', 'norge', 'норвегия', '挪威']),
  C('Finland', '🇫🇮', ['finland', 'suomi', 'финляндия', '芬兰', '芬蘭']),
  C('Iceland', '🇮🇸', ['iceland', 'ísland', 'island', 'исландия', '冰岛', '冰島']),
  C('Estonia', '🇪🇪', ['estonia', 'eesti', 'эстония', '爱沙尼亚', '愛沙尼亞']),
  C('Latvia', '🇱🇻', ['latvia', 'latvija', 'латвия', '拉脱维亚', '拉脫維亞']),
  C('Lithuania', '🇱🇹', ['lithuania', 'lietuva', 'литва', '立陶宛']),
  C('Ukraine', '🇺🇦', ['ukraine', 'украина', 'україна', '乌克兰', '烏克蘭']),
  C('Russia', '🇷🇺', ['russia', 'russian federation', 'россия', 'rossiya', '俄罗斯', '俄羅斯']),
  C('Belarus', '🇧🇾', ['belarus', 'беларусь', 'belarusia', '白俄罗斯', '白俄羅斯']),
  C('Turkey', '🇹🇷', ['turkey', 'türkiye', 'turkiye', 'турция', '土耳其']),
  C('Cyprus', '🇨🇾', ['cyprus', 'κύπρος', 'kipr', 'кипр', '塞浦路斯']),
  C('Malta', '🇲🇹', ['malta', 'мальта', '马耳他', '馬爾他']),

  // —— 亚洲 / 其他常见贸易伙伴 ——
  C('China', '🇨🇳', ['china', '中国', '中國', '中华人民共和国', 'prc']),
  C('Hong Kong, China', '🇭🇰', ['hong kong', 'hong kong, china', '中国香港', '香港', 'hk']),
  C('Taiwan, China', '🇹🇼', ['taiwan, china', 'taiwan', '中国台湾', '台湾', '臺灣', 'tw']),
  C('Macao, China', '🇲🇴', ['macao, china', 'macao', 'macau', '中国澳门', '澳门', '澳門']),
  C('Japan', '🇯🇵', ['japan', '日本', '日本國', 'nippon']),
  C('South Korea', '🇰🇷', ['south korea', 'korea', 'republic of korea', '韩国', '韓國', '한국']),
  C('Singapore', '🇸🇬', ['singapore', '新加坡']),
  C('Malaysia', '🇲🇾', ['malaysia', '马来西亚', '馬來西亞']),
  C('Thailand', '🇹🇭', ['thailand', '泰国', '泰國']),
  C('Vietnam', '🇻🇳', ['vietnam', 'viet nam', '越南']),
  C('Indonesia', '🇮🇩', ['indonesia', '印度尼西亚', '印度尼西亞']),
  C('Philippines', '🇵🇭', ['philippines', '菲律宾', '菲律賓']),
  C('India', '🇮🇳', ['india', '印度']),
  C('Pakistan', '🇵🇰', ['pakistan', '巴基斯坦']),
  C('United Arab Emirates', '🇦🇪', ['united arab emirates', 'uae', '阿联酋', '阿拉伯联合酋长国']),
  C('Saudi Arabia', '🇸🇦', ['saudi arabia', 'saudi', '沙特阿拉伯', '沙特']),
  C('Israel', '🇮🇱', ['israel', '以色列']),

  // —— 美洲 / 非洲 / 大洋洲 ——
  C('United States', '🇺🇸', ['united states', 'usa', 'us', 'united states of america', '美国', '美國']),
  C('Canada', '🇨🇦', ['canada', '加拿大']),
  C('Mexico', '🇲🇽', ['mexico', '墨西哥']),
  C('Brazil', '🇧🇷', ['brazil', 'brasil', '巴西']),
  C('Argentina', '🇦🇷', ['argentina', '阿根廷']),
  C('Chile', '🇨🇱', ['chile', '智利']),
  C('Colombia', '🇨🇴', ['colombia', '哥伦比亚', '哥倫比亞']),
  C('Peru', '🇵🇪', ['peru', '秘鲁', '秘魯']),
  C('Australia', '🇦🇺', ['australia', '澳大利亚', '澳大利亞']),
  C('New Zealand', '🇳🇿', ['new zealand', '新西兰', '新西蘭']),
  C('South Africa', '🇿🇦', ['south africa', '南非']),
  C('Egypt', '🇪🇬', ['egypt', '埃及']),
  C('Morocco', '🇲🇦', ['morocco', '摩洛哥']),
  C('Nigeria', '🇳🇬', ['nigeria', '尼日利亚', '奈及利亞']),
  C('Kenya', '🇰🇪', ['kenya', '肯尼亚', '肯亞']),
];

/** 归一化比较用：小写、去首尾空白、压缩内部空白 */
export function normalizeCountryKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '');
}

/** 别名 -> 规范名 */
const ALIAS_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const c of COUNTRIES) {
    // 规范名本身也要能反查
    m.set(normalizeCountryKey(c.canonical), c.canonical);
    for (const a of c.aliases) m.set(normalizeCountryKey(a), c.canonical);
  }
  return m;
})();

/**
 * 把任意写法归并成规范名。表里没有的返回 null（调用方决定保留原文还是丢弃）。
 * 注意：**不做**模糊/近似匹配，只认显式别名——模糊匹配会把 "Guinea" 和
 * "Guinea-Bissau" 这类搞混，宁可漏也不要错。
 */
export function canonicalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return ALIAS_INDEX.get(normalizeCountryKey(raw)) ?? null;
}

/** 规范名的国旗 emoji；查不到返回空串（调用方可选择不显示） */
export function countryFlag(raw: string | null | undefined): string {
  const canonical = canonicalizeCountry(raw);
  if (!canonical) return '';
  return COUNTRIES.find((c) => c.canonical === canonical)?.flag ?? '';
}

/**
 * 规范名对应的**所有已知原始写法**——用于把筛选条件下推到 SQL。
 * 数据库里存的是原始字符串，只能拿所有别名去 inArray 匹配。
 */
export function rawAliasesFor(canonicalOrRaw: string): string[] {
  const canonical = canonicalizeCountry(canonicalOrRaw);
  if (!canonical) return [canonicalOrRaw];
  const entry = COUNTRIES.find((c) => c.canonical === canonical);
  if (!entry) return [canonicalOrRaw];
  return [entry.canonical, ...entry.aliases];
}
