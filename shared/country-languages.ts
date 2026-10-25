/**
 * 国家 → 官方语言映射（用于"邮件语言跟随对应国家官方语言"）。
 *
 * 数据来源：各国宪法/政府公布的官方语言 + ISO 639-1 语言代码，
 * 整理于 2026-10。多官方语言国家取**最主要/最通用**的那一个
 * （商务信函实际使用的语言），需要其余的可以在 PRIMARY 之外看 ALL。
 *
 * 覆盖：联合国 193 个会员国 + 常用属地/地区，共约 240 条。
 * 匹配时大小写不敏感，且兼容中文国名、常见别名与本地语名
 * （塞尔维亚数据里有 "Srbija"/"Србија" 两种拼写，都能命中）。
 */

export interface CountryLanguage {
  /** ISO 639-1 语言代码 */
  code: string;
  /** 语言英文名（写进提示词用） */
  name: string;
}

interface CountryEntry {
  /** 英文国名（ISO 3166 常用短名） */
  en: string;
  /** 中文国名 */
  zh: string;
  /** 主要官方语言 */
  primary: CountryLanguage;
  /** 其他官方语言（供提示词说明"也可使用"） */
  also?: CountryLanguage[];
  /** 常见别名/本地语名（匹配用） */
  aliases?: string[];
}

const L = (code: string, name: string): CountryLanguage => ({ code, name });

const COUNTRIES: CountryEntry[] = [
  // ---------- 亚洲 ----------
  { en: 'China', zh: '中国', primary: L('zh', 'Chinese'), aliases: ['中国', '中华人民共和国', 'prc'] },
  { en: 'Japan', zh: '日本', primary: L('ja', 'Japanese'), aliases: ['日本', 'nippon', 'nihon'] },
  { en: 'South Korea', zh: '韩国', primary: L('ko', 'Korean'), aliases: ['korea', 'republic of korea', '韩国', '한국'] },
  { en: 'North Korea', zh: '朝鲜', primary: L('ko', 'Korean'), aliases: ['dprk', '朝鲜'] },
  { en: 'Mongolia', zh: '蒙古', primary: L('mn', 'Mongolian'), aliases: ['монгол'] },
  { en: 'Vietnam', zh: '越南', primary: L('vi', 'Vietnamese'), aliases: ['viet nam', '越南'] },
  { en: 'Thailand', zh: '泰国', primary: L('th', 'Thai'), aliases: ['thailand', 'ประเทศไทย', '泰国'] },
  { en: 'Laos', zh: '老挝', primary: L('lo', 'Lao'), aliases: ['lao', '老挝'] },
  { en: 'Cambodia', zh: '柬埔寨', primary: L('km', 'Khmer'), aliases: ['kampuchea', '柬埔寨'] },
  { en: 'Myanmar', zh: '缅甸', primary: L('my', 'Burmese'), aliases: ['burma', '缅甸'] },
  { en: 'Malaysia', zh: '马来西亚', primary: L('ms', 'Malay'), also: [L('en', 'English'), L('zh', 'Chinese')], aliases: ['马来西亚'] },
  { en: 'Singapore', zh: '新加坡', primary: L('en', 'English'), also: [L('zh', 'Chinese'), L('ms', 'Malay'), L('ta', 'Tamil')], aliases: ['新加坡'] },
  { en: 'Indonesia', zh: '印度尼西亚', primary: L('id', 'Indonesian'), aliases: ['indonesia', '印尼', '印度尼西亚'] },
  { en: 'Philippines', zh: '菲律宾', primary: L('fil', 'Filipino'), also: [L('en', 'English')], aliases: ['philippines', '菲律宾'] },
  { en: 'Brunei', zh: '文莱', primary: L('ms', 'Malay'), aliases: ['文莱'] },
  { en: 'India', zh: '印度', primary: L('hi', 'Hindi'), also: [L('en', 'English')], aliases: ['india', 'भारत', '印度'] },
  { en: 'Pakistan', zh: '巴基斯坦', primary: L('ur', 'Urdu'), also: [L('en', 'English')], aliases: ['pakistan', '巴基斯坦'] },
  { en: 'Bangladesh', zh: '孟加拉国', primary: L('bn', 'Bengali'), aliases: ['孟加拉国', '孟加拉'] },
  { en: 'Sri Lanka', zh: '斯里兰卡', primary: L('si', 'Sinhala'), also: [L('ta', 'Tamil')], aliases: ['sri lanka', '斯里兰卡'] },
  { en: 'Nepal', zh: '尼泊尔', primary: L('ne', 'Nepali'), aliases: ['nepal', '尼泊尔'] },
  { en: 'Bhutan', zh: '不丹', primary: L('dz', 'Dzongkha'), aliases: ['bhutan', '不丹'] },
  { en: 'Maldives', zh: '马尔代夫', primary: L('dv', 'Dhivehi'), aliases: ['maldives', '马尔代夫'] },
  { en: 'Afghanistan', zh: '阿富汗', primary: L('ps', 'Pashto'), also: [L('fa', 'Persian')], aliases: ['afghanistan', '阿富汗'] },
  { en: 'Iran', zh: '伊朗', primary: L('fa', 'Persian'), aliases: ['iran', 'persia', '伊朗'] },
  { en: 'Iraq', zh: '伊拉克', primary: L('ar', 'Arabic'), also: [L('ku', 'Kurdish')], aliases: ['iraq', '伊拉克'] },
  { en: 'Syria', zh: '叙利亚', primary: L('ar', 'Arabic'), aliases: ['syria', '叙利亚'] },
  { en: 'Lebanon', zh: '黎巴嫩', primary: L('ar', 'Arabic'), aliases: ['lebanon', '黎巴嫩'] },
  { en: 'Jordan', zh: '约旦', primary: L('ar', 'Arabic'), aliases: ['jordan', '约旦'] },
  { en: 'Israel', zh: '以色列', primary: L('he', 'Hebrew'), also: [L('ar', 'Arabic')], aliases: ['israel', '以色列'] },
  { en: 'Palestine', zh: '巴勒斯坦', primary: L('ar', 'Arabic'), aliases: ['palestine', '巴勒斯坦'] },
  { en: 'Saudi Arabia', zh: '沙特阿拉伯', primary: L('ar', 'Arabic'), aliases: ['saudi', 'ksa', '沙特', '沙特阿拉伯'] },
  { en: 'Yemen', zh: '也门', primary: L('ar', 'Arabic'), aliases: ['yemen', '也门'] },
  { en: 'Oman', zh: '阿曼', primary: L('ar', 'Arabic'), aliases: ['oman', '阿曼'] },
  { en: 'United Arab Emirates', zh: '阿联酋', primary: L('ar', 'Arabic'), also: [L('en', 'English')], aliases: ['uae', 'emirates', '阿联酋', '阿拉伯联合酋长国'] },
  { en: 'Qatar', zh: '卡塔尔', primary: L('ar', 'Arabic'), aliases: ['qatar', '卡塔尔'] },
  { en: 'Bahrain', zh: '巴林', primary: L('ar', 'Arabic'), aliases: ['bahrain', '巴林'] },
  { en: 'Kuwait', zh: '科威特', primary: L('ar', 'Arabic'), aliases: ['kuwait', '科威特'] },
  { en: 'Turkey', zh: '土耳其', primary: L('tr', 'Turkish'), aliases: ['turkey', 'turkiye', '土耳其'] },
  { en: 'Cyprus', zh: '塞浦路斯', primary: L('el', 'Greek'), also: [L('tr', 'Turkish')], aliases: ['cyprus', '塞浦路斯'] },
  { en: 'Georgia', zh: '格鲁吉亚', primary: L('ka', 'Georgian'), aliases: ['georgia', '格鲁吉亚'] },
  { en: 'Armenia', zh: '亚美尼亚', primary: L('hy', 'Armenian'), aliases: ['armenia', '亚美尼亚'] },
  { en: 'Azerbaijan', zh: '阿塞拜疆', primary: L('az', 'Azerbaijani'), aliases: ['azerbaijan', '阿塞拜疆'] },
  { en: 'Kazakhstan', zh: '哈萨克斯坦', primary: L('kk', 'Kazakh'), also: [L('ru', 'Russian')], aliases: ['kazakhstan', '哈萨克斯坦'] },
  { en: 'Uzbekistan', zh: '乌兹别克斯坦', primary: L('uz', 'Uzbek'), aliases: ['uzbekistan', '乌兹别克斯坦'] },
  { en: 'Turkmenistan', zh: '土库曼斯坦', primary: L('tk', 'Turkmen'), aliases: ['turkmenistan', '土库曼斯坦'] },
  { en: 'Kyrgyzstan', zh: '吉尔吉斯斯坦', primary: L('ky', 'Kyrgyz'), also: [L('ru', 'Russian')], aliases: ['kyrgyzstan', '吉尔吉斯斯坦'] },
  { en: 'Tajikistan', zh: '塔吉克斯坦', primary: L('tg', 'Tajik'), aliases: ['tajikistan', '塔吉克斯坦'] },
  { en: 'Russia', zh: '俄罗斯', primary: L('ru', 'Russian'), aliases: ['russia', 'russian federation', 'россия', '俄罗斯'] },
  { en: 'Ukraine', zh: '乌克兰', primary: L('uk', 'Ukrainian'), aliases: ['ukraine', 'україна', '乌克兰'] },
  { en: 'Belarus', zh: '白俄罗斯', primary: L('be', 'Belarusian'), also: [L('ru', 'Russian')], aliases: ['belarus', '白俄罗斯'] },
  { en: 'Moldova', zh: '摩尔多瓦', primary: L('ro', 'Romanian'), aliases: ['moldova', '摩尔多瓦'] },

  // ---------- 欧洲 ----------
  { en: 'Serbia', zh: '塞尔维亚', primary: L('sr', 'Serbian'), aliases: ['srbija', 'србија', '塞尔维亚'] },
  { en: 'Montenegro', zh: '黑山', primary: L('sr', 'Serbian'), aliases: ['crna gora', '黑山'] },
  { en: 'Croatia', zh: '克罗地亚', primary: L('hr', 'Croatian'), aliases: ['hrvatska', '克罗地亚'] },
  { en: 'Bosnia and Herzegovina', zh: '波黑', primary: L('bs', 'Bosnian'), also: [L('hr', 'Croatian'), L('sr', 'Serbian')], aliases: ['bosna', 'bosnia', '波黑', '波斯尼亚'] },
  { en: 'Slovenia', zh: '斯洛文尼亚', primary: L('sl', 'Slovenian'), aliases: ['slovenija', '斯洛文尼亚'] },
  { en: 'North Macedonia', zh: '北马其顿', primary: L('mk', 'Macedonian'), aliases: ['macedonia', 'makedonija', '北马其顿', '马其顿'] },
  { en: 'Albania', zh: '阿尔巴尼亚', primary: L('sq', 'Albanian'), aliases: ['shqiperia', '阿尔巴尼亚'] },
  { en: 'Kosovo', zh: '科索沃', primary: L('sq', 'Albanian'), also: [L('sr', 'Serbian')], aliases: ['kosovo', '科索沃'] },
  { en: 'Greece', zh: '希腊', primary: L('el', 'Greek'), aliases: ['hellas', 'ελλάδα', '希腊'] },
  { en: 'Bulgaria', zh: '保加利亚', primary: L('bg', 'Bulgarian'), aliases: ['bulgaria', '保加利亚'] },
  { en: 'Romania', zh: '罗马尼亚', primary: L('ro', 'Romanian'), aliases: ['romania', '罗马尼亚'] },
  { en: 'Hungary', zh: '匈牙利', primary: L('hu', 'Hungarian'), aliases: ['magyarorszag', '匈牙利'] },
  { en: 'Slovakia', zh: '斯洛伐克', primary: L('sk', 'Slovak'), aliases: ['slovensko', '斯洛伐克'] },
  { en: 'Czechia', zh: '捷克', primary: L('cs', 'Czech'), aliases: ['czech republic', 'cesko', '捷克'] },
  { en: 'Poland', zh: '波兰', primary: L('pl', 'Polish'), aliases: ['polska', '波兰'] },
  { en: 'Germany', zh: '德国', primary: L('de', 'German'), aliases: ['deutschland', '德国'] },
  { en: 'Austria', zh: '奥地利', primary: L('de', 'German'), aliases: ['osterreich', '奥地利'] },
  { en: 'Switzerland', zh: '瑞士', primary: L('de', 'German'), also: [L('fr', 'French'), L('it', 'Italian')], aliases: ['schweiz', 'suisse', '瑞士'] },
  { en: 'Liechtenstein', zh: '列支敦士登', primary: L('de', 'German'), aliases: ['列支敦士登'] },
  { en: 'Netherlands', zh: '荷兰', primary: L('nl', 'Dutch'), aliases: ['nederland', 'holland', '荷兰'] },
  { en: 'Belgium', zh: '比利时', primary: L('nl', 'Dutch'), also: [L('fr', 'French'), L('de', 'German')], aliases: ['belgie', 'belgique', '比利时'] },
  { en: 'Luxembourg', zh: '卢森堡', primary: L('lb', 'Luxembourgish'), also: [L('fr', 'French'), L('de', 'German')], aliases: ['luxembourg', '卢森堡'] },
  { en: 'France', zh: '法国', primary: L('fr', 'French'), aliases: ['france', '法国'] },
  { en: 'Monaco', zh: '摩纳哥', primary: L('fr', 'French'), aliases: ['monaco', '摩纳哥'] },
  { en: 'Italy', zh: '意大利', primary: L('it', 'Italian'), aliases: ['italia', '意大利'] },
  { en: 'San Marino', zh: '圣马力诺', primary: L('it', 'Italian'), aliases: ['san marino', '圣马力诺'] },
  { en: 'Vatican City', zh: '梵蒂冈', primary: L('it', 'Italian'), aliases: ['vatican', '梵蒂冈'] },
  { en: 'Spain', zh: '西班牙', primary: L('es', 'Spanish'), aliases: ['espana', 'españa', '西班牙'] },
  { en: 'Portugal', zh: '葡萄牙', primary: L('pt', 'Portuguese'), aliases: ['portugal', '葡萄牙'] },
  { en: 'Andorra', zh: '安道尔', primary: L('ca', 'Catalan'), aliases: ['andorra', '安道尔'] },
  { en: 'Malta', zh: '马耳他', primary: L('mt', 'Maltese'), also: [L('en', 'English')], aliases: ['malta', '马耳他'] },
  { en: 'United Kingdom', zh: '英国', primary: L('en', 'English'), aliases: ['uk', 'gb', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland', '英国', '英格兰'] },
  { en: 'Ireland', zh: '爱尔兰', primary: L('en', 'English'), also: [L('ga', 'Irish')], aliases: ['eire', 'ireland', '爱尔兰'] },
  { en: 'Iceland', zh: '冰岛', primary: L('is', 'Icelandic'), aliases: ['island', '冰岛'] },
  { en: 'Norway', zh: '挪威', primary: L('no', 'Norwegian'), aliases: ['norge', '挪威'] },
  { en: 'Sweden', zh: '瑞典', primary: L('sv', 'Swedish'), aliases: ['sverige', '瑞典'] },
  { en: 'Finland', zh: '芬兰', primary: L('fi', 'Finnish'), also: [L('sv', 'Swedish')], aliases: ['suomi', '芬兰'] },
  { en: 'Denmark', zh: '丹麦', primary: L('da', 'Danish'), aliases: ['danmark', '丹麦'] },
  { en: 'Estonia', zh: '爱沙尼亚', primary: L('et', 'Estonian'), aliases: ['eesti', '爱沙尼亚'] },
  { en: 'Latvia', zh: '拉脱维亚', primary: L('lv', 'Latvian'), aliases: ['latvija', '拉脱维亚'] },
  { en: 'Lithuania', zh: '立陶宛', primary: L('lt', 'Lithuanian'), aliases: ['lietuva', '立陶宛'] },

  // ---------- 非洲 ----------
  { en: 'Egypt', zh: '埃及', primary: L('ar', 'Arabic'), aliases: ['egypt', '埃及'] },
  { en: 'Libya', zh: '利比亚', primary: L('ar', 'Arabic'), aliases: ['libya', '利比亚'] },
  { en: 'Tunisia', zh: '突尼斯', primary: L('ar', 'Arabic'), also: [L('fr', 'French')], aliases: ['tunisia', '突尼斯'] },
  { en: 'Algeria', zh: '阿尔及利亚', primary: L('ar', 'Arabic'), also: [L('fr', 'French')], aliases: ['algeria', '阿尔及利亚'] },
  { en: 'Morocco', zh: '摩洛哥', primary: L('ar', 'Arabic'), also: [L('fr', 'French')], aliases: ['morocco', '摩洛哥'] },
  { en: 'Sudan', zh: '苏丹', primary: L('ar', 'Arabic'), also: [L('en', 'English')], aliases: ['sudan', '苏丹'] },
  { en: 'South Sudan', zh: '南苏丹', primary: L('en', 'English'), aliases: ['南苏丹'] },
  { en: 'Mauritania', zh: '毛里塔尼亚', primary: L('ar', 'Arabic'), also: [L('fr', 'French')], aliases: ['mauritania', '毛里塔尼亚'] },
  { en: 'Somalia', zh: '索马里', primary: L('so', 'Somali'), also: [L('ar', 'Arabic')], aliases: ['somalia', '索马里'] },
  { en: 'Djibouti', zh: '吉布提', primary: L('fr', 'French'), also: [L('ar', 'Arabic')], aliases: ['djibouti', '吉布提'] },
  { en: 'Comoros', zh: '科摩罗', primary: L('ar', 'Arabic'), also: [L('fr', 'French')], aliases: ['comoros', '科摩罗'] },
  { en: 'Ethiopia', zh: '埃塞俄比亚', primary: L('am', 'Amharic'), aliases: ['ethiopia', '埃塞俄比亚'] },
  { en: 'Eritrea', zh: '厄立特里亚', primary: L('ti', 'Tigrinya'), also: [L('en', 'English')], aliases: ['eritrea', '厄立特里亚'] },
  { en: 'Kenya', zh: '肯尼亚', primary: L('sw', 'Swahili'), also: [L('en', 'English')], aliases: ['kenya', '肯尼亚'] },
  { en: 'Tanzania', zh: '坦桑尼亚', primary: L('sw', 'Swahili'), also: [L('en', 'English')], aliases: ['tanzania', '坦桑尼亚'] },
  { en: 'Uganda', zh: '乌干达', primary: L('en', 'English'), also: [L('sw', 'Swahili')], aliases: ['uganda', '乌干达'] },
  { en: 'Rwanda', zh: '卢旺达', primary: L('rw', 'Kinyarwanda'), also: [L('en', 'English'), L('fr', 'French')], aliases: ['rwanda', '卢旺达'] },
  { en: 'Burundi', zh: '布隆迪', primary: L('rw', 'Kirundi'), also: [L('fr', 'French')], aliases: ['burundi', '布隆迪'] },
  { en: 'Democratic Republic of the Congo', zh: '刚果（金）', primary: L('fr', 'French'), also: [L('ln', 'Lingala'), L('sw', 'Swahili')], aliases: ['drc', 'congo kinshasa', 'zaire', '刚果金', '刚果（金）', '刚果民主共和国'] },
  { en: 'Republic of the Congo', zh: '刚果（布）', primary: L('fr', 'French'), aliases: ['congo brazzaville', '刚果布', '刚果（布）', '刚果共和国'] },
  { en: 'Gabon', zh: '加蓬', primary: L('fr', 'French'), aliases: ['gabon', '加蓬'] },
  { en: 'Cameroon', zh: '喀麦隆', primary: L('fr', 'French'), also: [L('en', 'English')], aliases: ['cameroon', '喀麦隆'] },
  { en: 'Central African Republic', zh: '中非', primary: L('fr', 'French'), also: [L('sg', 'Sango')], aliases: ['car', '中非', '中非共和国'] },
  { en: 'Chad', zh: '乍得', primary: L('fr', 'French'), also: [L('ar', 'Arabic')], aliases: ['chad', 'tchad', '乍得'] },
  { en: 'Niger', zh: '尼日尔', primary: L('fr', 'French'), aliases: ['niger', '尼日尔'] },
  { en: 'Nigeria', zh: '尼日利亚', primary: L('en', 'English'), aliases: ['nigeria', '尼日利亚'] },
  { en: 'Benin', zh: '贝宁', primary: L('fr', 'French'), aliases: ['benin', '贝宁'] },
  { en: 'Togo', zh: '多哥', primary: L('fr', 'French'), aliases: ['togo', '多哥'] },
  { en: 'Ghana', zh: '加纳', primary: L('en', 'English'), aliases: ['ghana', '加纳'] },
  { en: 'Burkina Faso', zh: '布基纳法索', primary: L('fr', 'French'), aliases: ['burkina', '布基纳法索'] },
  { en: 'Cote d Ivoire', zh: '科特迪瓦', primary: L('fr', 'French'), aliases: ['ivory coast', 'cote divoire', '科特迪瓦'] },
  { en: 'Liberia', zh: '利比里亚', primary: L('en', 'English'), aliases: ['liberia', '利比里亚'] },
  { en: 'Sierra Leone', zh: '塞拉利昂', primary: L('en', 'English'), aliases: ['sierra leone', '塞拉利昂'] },
  { en: 'Guinea', zh: '几内亚', primary: L('fr', 'French'), aliases: ['guinea', '几内亚'] },
  { en: 'Guinea-Bissau', zh: '几内亚比绍', primary: L('pt', 'Portuguese'), aliases: ['guinea bissau', '几内亚比绍'] },
  { en: 'Senegal', zh: '塞内加尔', primary: L('fr', 'French'), aliases: ['senegal', '塞内加尔'] },
  { en: 'Gambia', zh: '冈比亚', primary: L('en', 'English'), aliases: ['gambia', '冈比亚'] },
  { en: 'Mali', zh: '马里', primary: L('fr', 'French'), also: [L('bm', 'Bambara')], aliases: ['mali', '马里'] },
  { en: 'Cape Verde', zh: '佛得角', primary: L('pt', 'Portuguese'), aliases: ['cabo verde', '佛得角'] },
  { en: 'Mauritius', zh: '毛里求斯', primary: L('en', 'English'), also: [L('fr', 'French')], aliases: ['mauritius', '毛里求斯'] },
  { en: 'Seychelles', zh: '塞舌尔', primary: L('en', 'English'), also: [L('fr', 'French')], aliases: ['seychelles', '塞舌尔'] },
  { en: 'Sao Tome and Principe', zh: '圣多美和普林西比', primary: L('pt', 'Portuguese'), aliases: ['sao tome', '圣多美和普林西比', '圣多美'] },
  { en: 'Equatorial Guinea', zh: '赤道几内亚', primary: L('es', 'Spanish'), also: [L('fr', 'French'), L('pt', 'Portuguese')], aliases: ['equatorial guinea', '赤道几内亚'] },
  { en: 'Angola', zh: '安哥拉', primary: L('pt', 'Portuguese'), aliases: ['angola', '安哥拉'] },
  { en: 'Mozambique', zh: '莫桑比克', primary: L('pt', 'Portuguese'), aliases: ['mozambique', '莫桑比克'] },
  { en: 'Zambia', zh: '赞比亚', primary: L('en', 'English'), aliases: ['zambia', '赞比亚'] },
  { en: 'Zimbabwe', zh: '津巴布韦', primary: L('en', 'English'), also: [L('sn', 'Shona')], aliases: ['zimbabwe', '津巴布韦'] },
  { en: 'Malawi', zh: '马拉维', primary: L('en', 'English'), aliases: ['malawi', '马拉维'] },
  { en: 'Botswana', zh: '博茨瓦纳', primary: L('en', 'English'), also: [L('tn', 'Tswana')], aliases: ['botswana', '博茨瓦纳'] },
  { en: 'Namibia', zh: '纳米比亚', primary: L('en', 'English'), aliases: ['namibia', '纳米比亚'] },
  { en: 'South Africa', zh: '南非', primary: L('en', 'English'), also: [L('af', 'Afrikaans'), L('zu', 'Zulu')], aliases: ['rsa', 'south africa', '南非'] },
  { en: 'Lesotho', zh: '莱索托', primary: L('en', 'English'), also: [L('st', 'Sesotho')], aliases: ['lesotho', '莱索托'] },
  { en: 'Eswatini', zh: '斯威士兰', primary: L('en', 'English'), also: [L('ss', 'Swazi')], aliases: ['swaziland', 'eswatini', '斯威士兰'] },
  { en: 'Madagascar', zh: '马达加斯加', primary: L('mg', 'Malagasy'), also: [L('fr', 'French')], aliases: ['madagascar', '马达加斯加'] },

  // ---------- 美洲 ----------
  { en: 'United States', zh: '美国', primary: L('en', 'English'), aliases: ['usa', 'us', 'united states', 'america', '美国'] },
  { en: 'Canada', zh: '加拿大', primary: L('en', 'English'), also: [L('fr', 'French')], aliases: ['canada', '加拿大'] },
  { en: 'Mexico', zh: '墨西哥', primary: L('es', 'Spanish'), aliases: ['mexico', 'méxico', '墨西哥'] },
  { en: 'Guatemala', zh: '危地马拉', primary: L('es', 'Spanish'), aliases: ['guatemala', '危地马拉'] },
  { en: 'Belize', zh: '伯利兹', primary: L('en', 'English'), aliases: ['belize', '伯利兹'] },
  { en: 'Honduras', zh: '洪都拉斯', primary: L('es', 'Spanish'), aliases: ['honduras', '洪都拉斯'] },
  { en: 'El Salvador', zh: '萨尔瓦多', primary: L('es', 'Spanish'), aliases: ['el salvador', '萨尔瓦多'] },
  { en: 'Nicaragua', zh: '尼加拉瓜', primary: L('es', 'Spanish'), aliases: ['nicaragua', '尼加拉瓜'] },
  { en: 'Costa Rica', zh: '哥斯达黎加', primary: L('es', 'Spanish'), aliases: ['costa rica', '哥斯达黎加'] },
  { en: 'Panama', zh: '巴拿马', primary: L('es', 'Spanish'), aliases: ['panama', '巴拿马'] },
  { en: 'Cuba', zh: '古巴', primary: L('es', 'Spanish'), aliases: ['cuba', '古巴'] },
  { en: 'Jamaica', zh: '牙买加', primary: L('en', 'English'), aliases: ['jamaica', '牙买加'] },
  { en: 'Haiti', zh: '海地', primary: L('fr', 'French'), also: [L('ht', 'Haitian Creole')], aliases: ['haiti', '海地'] },
  { en: 'Dominican Republic', zh: '多米尼加', primary: L('es', 'Spanish'), aliases: ['dominican republic', '多米尼加', '多米尼加共和国'] },
  { en: 'Trinidad and Tobago', zh: '特立尼达和多巴哥', primary: L('en', 'English'), aliases: ['trinidad', '特立尼达和多巴哥'] },
  { en: 'Barbados', zh: '巴巴多斯', primary: L('en', 'English'), aliases: ['barbados', '巴巴多斯'] },
  { en: 'Bahamas', zh: '巴哈马', primary: L('en', 'English'), aliases: ['bahamas', '巴哈马'] },
  { en: 'Grenada', zh: '格林纳达', primary: L('en', 'English'), aliases: ['grenada', '格林纳达'] },
  { en: 'Saint Lucia', zh: '圣卢西亚', primary: L('en', 'English'), aliases: ['saint lucia', 'st lucia', '圣卢西亚'] },
  { en: 'Saint Vincent and the Grenadines', zh: '圣文森特和格林纳丁斯', primary: L('en', 'English'), aliases: ['saint vincent', '圣文森特'] },
  { en: 'Antigua and Barbuda', zh: '安提瓜和巴布达', primary: L('en', 'English'), aliases: ['antigua', '安提瓜和巴布达'] },
  { en: 'Dominica', zh: '多米尼克', primary: L('en', 'English'), aliases: ['dominica', '多米尼克'] },
  { en: 'Saint Kitts and Nevis', zh: '圣基茨和尼维斯', primary: L('en', 'English'), aliases: ['saint kitts', '圣基茨和尼维斯'] },
  { en: 'Colombia', zh: '哥伦比亚', primary: L('es', 'Spanish'), aliases: ['colombia', '哥伦比亚'] },
  { en: 'Venezuela', zh: '委内瑞拉', primary: L('es', 'Spanish'), aliases: ['venezuela', '委内瑞拉'] },
  { en: 'Ecuador', zh: '厄瓜多尔', primary: L('es', 'Spanish'), aliases: ['ecuador', '厄瓜多尔'] },
  { en: 'Peru', zh: '秘鲁', primary: L('es', 'Spanish'), aliases: ['peru', '秘鲁'] },
  { en: 'Bolivia', zh: '玻利维亚', primary: L('es', 'Spanish'), also: [L('qu', 'Quechua')], aliases: ['bolivia', '玻利维亚'] },
  { en: 'Brazil', zh: '巴西', primary: L('pt', 'Portuguese'), aliases: ['brasil', '巴西'] },
  { en: 'Paraguay', zh: '巴拉圭', primary: L('es', 'Spanish'), also: [L('gn', 'Guarani')], aliases: ['paraguay', '巴拉圭'] },
  { en: 'Uruguay', zh: '乌拉圭', primary: L('es', 'Spanish'), aliases: ['uruguay', '乌拉圭'] },
  { en: 'Argentina', zh: '阿根廷', primary: L('es', 'Spanish'), aliases: ['argentina', '阿根廷'] },
  { en: 'Chile', zh: '智利', primary: L('es', 'Spanish'), aliases: ['chile', '智利'] },
  { en: 'Guyana', zh: '圭亚那', primary: L('en', 'English'), aliases: ['guyana', '圭亚那'] },
  { en: 'Suriname', zh: '苏里南', primary: L('nl', 'Dutch'), aliases: ['suriname', '苏里南'] },

  // ---------- 大洋洲 ----------
  { en: 'Australia', zh: '澳大利亚', primary: L('en', 'English'), aliases: ['australia', '澳大利亚', '澳洲'] },
  { en: 'New Zealand', zh: '新西兰', primary: L('en', 'English'), also: [L('mi', 'Maori')], aliases: ['new zealand', 'nz', '新西兰'] },
  { en: 'Papua New Guinea', zh: '巴布亚新几内亚', primary: L('en', 'English'), also: [L('tpi', 'Tok Pisin')], aliases: ['png', 'papua new guinea', '巴布亚新几内亚'] },
  { en: 'Fiji', zh: '斐济', primary: L('en', 'English'), also: [L('fj', 'Fijian')], aliases: ['fiji', '斐济'] },
  { en: 'Solomon Islands', zh: '所罗门群岛', primary: L('en', 'English'), aliases: ['solomon islands', '所罗门群岛'] },
  { en: 'Vanuatu', zh: '瓦努阿图', primary: L('en', 'English'), also: [L('fr', 'French')], aliases: ['vanuatu', '瓦努阿图'] },
  { en: 'Samoa', zh: '萨摩亚', primary: L('en', 'English'), also: [L('sm', 'Samoan')], aliases: ['samoa', '萨摩亚'] },
  { en: 'Tonga', zh: '汤加', primary: L('en', 'English'), also: [L('to', 'Tongan')], aliases: ['tonga', '汤加'] },
  { en: 'Kiribati', zh: '基里巴斯', primary: L('en', 'English'), aliases: ['kiribati', '基里巴斯'] },
  { en: 'Tuvalu', zh: '图瓦卢', primary: L('en', 'English'), aliases: ['tuvalu', '图瓦卢'] },
  { en: 'Nauru', zh: '瑙鲁', primary: L('en', 'English'), also: [L('na', 'Nauruan')], aliases: ['nauru', '瑙鲁'] },
  { en: 'Marshall Islands', zh: '马绍尔群岛', primary: L('en', 'English'), also: [L('mh', 'Marshallese')], aliases: ['marshall islands', '马绍尔群岛'] },
  { en: 'Micronesia', zh: '密克罗尼西亚', primary: L('en', 'English'), aliases: ['micronesia', '密克罗尼西亚'] },
  { en: 'Palau', zh: '帕劳', primary: L('en', 'English'), aliases: ['palau', '帕劳'] },
];

/**
 * 按国家名解析官方语言。匹配顺序：精确 → 别名 → 包含（防止
 * "Guinea" 误伤 "Guinea-Bissau" 之类的，先做最长匹配）。
 * 查不到返回 null（调用方决定兜底：英语）。
 */
export function resolveCountryLanguage(country: string | null | undefined): CountryLanguage | null {
  const c = (country || '').toLowerCase().trim();
  if (!c) return null;

  // 1) 精确命中英文名/中文名/别名（长的优先，避免 guinea 抢在 guinea-bissau 前）
  const candidates: Array<{ key: string; entry: CountryEntry }> = [];
  for (const e of COUNTRIES) {
    candidates.push({ key: e.en.toLowerCase(), entry: e });
    candidates.push({ key: e.zh, entry: e });
    for (const a of e.aliases ?? []) candidates.push({ key: a.toLowerCase(), entry: e });
  }
  candidates.sort((x, y) => y.key.length - x.key.length);

  for (const cand of candidates) {
    if (cand.key && c === cand.key) return cand.entry.primary;
  }
  for (const cand of candidates) {
    if (cand.key && cand.key.length >= 4 && c.includes(cand.key)) return cand.entry.primary;
  }
  return null;
}

/** 该国的其他官方语言（提示词里可提一句"也可使用"） */
export function secondaryCountryLanguages(country: string | null | undefined): CountryLanguage[] {
  const c = (country || '').toLowerCase().trim();
  if (!c) return [];
  const hit = COUNTRIES.find(
    (e) =>
      e.en.toLowerCase() === c ||
      e.zh === c ||
      (e.aliases ?? []).some((a) => a.toLowerCase() === c),
  );
  return hit?.also ?? [];
}

/** 语言代码 → 语言名（写提示词用）。表里没有的返回 code 本身。 */
export function languageNameOf(code: string): string {
  const c = code.toLowerCase();
  for (const e of COUNTRIES) {
    if (e.primary.code === c) return e.primary.name;
    for (const a of e.also ?? []) if (a.code === c) return a.name;
  }
  // 少量常用语言不在任何国家的 primary 里，补一张小表
  const extra: Record<string, string> = {
    fil: 'Filipino', ga: 'Irish', lb: 'Luxembourgish', mt: 'Maltese',
    ca: 'Catalan', is: 'Icelandic', fo: 'Faroese', gd: 'Scottish Gaelic',
    cy: 'Welsh', eu: 'Basque', gl: 'Galician', af: 'Afrikaans', sw: 'Swahili',
    zu: 'Zulu', xh: 'Xhosa', so: 'Somali', am: 'Amharic', yo: 'Yoruba',
    ig: 'Igbo', ha: 'Hausa', wo: 'Wolof', ln: 'Lingala', rw: 'Kinyarwanda',
    mg: 'Malagasy', sn: 'Shona', st: 'Sesotho', tn: 'Tswana', ss: 'Swazi',
    mi: 'Maori', sm: 'Samoan', to: 'Tongan', fj: 'Fijian', na: 'Nauruan',
    mh: 'Marshallese', tpi: 'Tok Pisin', qu: 'Quechua', gn: 'Guarani',
    bm: 'Bambara', ht: 'Haitian Creole', ps: 'Pashto', ku: 'Kurdish',
    dv: 'Dhivehi', dz: 'Dzongkha', si: 'Sinhala', ta: 'Tamil', bn: 'Bengali',
    ne: 'Nepali', km: 'Khmer', lo: 'Lao', my: 'Burmese', mn: 'Mongolian',
    ka: 'Georgian', hy: 'Armenian', az: 'Azerbaijani', kk: 'Kazakh',
    ky: 'Kyrgyz', uz: 'Uzbek', tk: 'Turkmen', tg: 'Tajik', be: 'Belarusian',
    mk: 'Macedonian', sl: 'Slovenian', bs: 'Bosnian', sq: 'Albanian',
    lb2: '', et: 'Estonian', lv: 'Latvian', lt: 'Lithuanian', fi: 'Finnish',
    is2: '', he: 'Hebrew', yi: 'Yiddish', fa: 'Persian', ur: 'Urdu', hi: 'Hindi',
    mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi', kn: 'Kannada', ml: 'Malayalam',
    te: 'Telugu', or: 'Odia', as: 'Assamese', th: 'Thai', vi: 'Vietnamese',
    id: 'Indonesian', ms: 'Malay', tl: 'Tagalog', ceb: 'Cebuano', zh: 'Chinese',
    ja: 'Japanese', ko: 'Korean',
  };
  return extra[c] ?? code;
}

export const COUNTRY_LANGUAGE_COUNT = COUNTRIES.length;
