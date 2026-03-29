// Persona 定义 + 预设播客配置
// 数据来源：PRODUCT_ARCH.md Section 4.2 + Section 7.2

export const PERSONAS = [
  {
    id: 'user_a',
    letter: 'A',
    label: '欧美流行重度发烧友',
    shortLabel: '用户A',
    desc: '欧美流行、电子、Hip-hop'
  },
  {
    id: 'user_b',
    letter: 'B',
    label: '喜欢听国语民谣、轻音乐',
    shortLabel: '用户B',
    desc: '华语民谣、轻音乐、Acoustic'
  },
  {
    id: 'user_c',
    letter: 'C',
    label: '喜欢听古典乐、播客',
    shortLabel: '用户C',
    desc: '古典乐、知识播客、有声书'
  }
];

// 行程类型枚举（Section 4.2 链路 C）
export const TRIP_SCENES = [
  { id: 'morning_commute', label: '早上通勤' },
  { id: 'commute_home', label: '下班回家' },
  { id: 'weekend_outing', label: '周末出游' },
  { id: 'couple_time', label: '情侣时光' },
  { id: 'kid_mode', label: '儿童' }
];

// 预设播客配置（Section 7.2）
// 实测时长来自 PRODUCT_ARCH.md Section 3.1 性能基线表
// Screen 6 设计稿 user_a 文案严格对照
export const PODCAST_PRESETS = {
  user_a: [
    {
      id: 'ai_tech_01',
      title: 'AI 重塑未来工作方式',
      desc: '从大模型到具身智能，AI将如何改变职场',
      source_url: 'https://mp.weixin.qq.com/s/g5-Y-7H1hfovmyBcB6WSqQ',
      cdn_url: '/audio/ai_tech_01.mp3',
      duration_sec: 1110  // 18.5min
    },
    {
      id: 'people_02',
      title: '一位创业者的传奇十年',
      desc: '从校园创业到百亿估值的心路历程',
      source_url: 'https://mp.weixin.qq.com/s/a97XwPmBDUQsnlNs69ozDA',
      cdn_url: '/audio/people_02.mp3',
      duration_sec: 870   // 14.5min
    },
    {
      id: 'biz_01',
      title: '顶尖管理者的决策思维',
      desc: '商业世界中那些反直觉的管理智慧',
      source_url: 'https://mp.weixin.qq.com/s/F5T7weR-FDKIdTDa5SROBg',
      cdn_url: '/audio/biz_01.mp3',
      duration_sec: 618   // 10.3min
    },
    {
      id: 'ai_tech_02',
      title: '2026 AI 十大趋势解读',
      desc: '大模型、Agent、自动驾驶...年度盘点',
      source_url: 'https://mp.weixin.qq.com/s/6sZTC1D-hMwekVJSjbTsfQ',
      cdn_url: '/audio/ai_tech_02.mp3',
      duration_sec: 498   // 8.3min
    }
  ],
  user_b: [
    {
      id: 'people_01',
      title: '音乐人的灵感与孤独',
      desc: '独立音乐人如何在商业浪潮中坚守创作',
      source_url: 'https://mp.weixin.qq.com/s/7cxVNtXnHp46eqqO226OJA',
      cdn_url: '/audio/people_01.mp3',
      duration_sec: 300   // 5.0min
    },
    {
      id: 'biz_02',
      title: '慢生活经济学',
      desc: '当效率不再是唯一追求，生活的另一种可能',
      source_url: 'https://mp.weixin.qq.com/s/k9vxG8d2q_tt9iactR7HpQ',
      cdn_url: '/audio/biz_02.mp3',
      duration_sec: 450   // 7.5min
    },
    {
      id: 'people_02',
      title: '一位创业者的传奇十年',
      desc: '从校园创业到百亿估值的心路历程',
      source_url: 'https://mp.weixin.qq.com/s/a97XwPmBDUQsnlNs69ozDA',
      cdn_url: '/audio/people_02.mp3',
      duration_sec: 870   // 14.5min
    },
    {
      id: 'ai_tech_02',
      title: '科技如何改变我们听音乐',
      desc: 'AI编曲、空间音频、个性化推荐的未来',
      source_url: 'https://mp.weixin.qq.com/s/6sZTC1D-hMwekVJSjbTsfQ',
      cdn_url: '/audio/ai_tech_02.mp3',
      duration_sec: 498   // 8.3min
    }
  ],
  user_c: [
    {
      id: 'biz_03',
      title: '商业帝国的兴衰启示',
      desc: '从历史视角看企业成败的底层逻辑',
      source_url: 'https://mp.weixin.qq.com/s/jzAhk7UhhqZAWer4WhFaEg',
      cdn_url: '/audio/biz_03.mp3',
      duration_sec: 1728  // 28.8min
    },
    {
      id: 'ai_tech_01',
      title: 'AI 重塑未来工作方式',
      desc: '从大模型到具身智能，AI将如何改变职场',
      source_url: 'https://mp.weixin.qq.com/s/g5-Y-7H1hfovmyBcB6WSqQ',
      cdn_url: '/audio/ai_tech_01.mp3',
      duration_sec: 1110  // 18.5min
    },
    {
      id: 'biz_01',
      title: '顶尖管理者的决策思维',
      desc: '商业世界中那些反直觉的管理智慧',
      source_url: 'https://mp.weixin.qq.com/s/F5T7weR-FDKIdTDa5SROBg',
      cdn_url: '/audio/biz_01.mp3',
      duration_sec: 618   // 10.3min
    },
    {
      id: 'people_01',
      title: '古典音乐的现代对话',
      desc: '当巴赫遇上算法，古典乐的新生',
      source_url: 'https://mp.weixin.qq.com/s/7cxVNtXnHp46eqqO226OJA',
      cdn_url: '/audio/people_01.mp3',
      duration_sec: 300   // 5.0min
    }
  ]
};

// 豆包播客发音人
export const SPEAKERS = [
  { id: 'zh_male_dayixiansheng_v2_saturn_bigtts', role: 'host_a' },
  { id: 'zh_female_mizaitongxue_v2_saturn_bigtts', role: 'host_b' }
];

// API 配置
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
export const MOCK_MODE = !API_BASE_URL;
export const ACK_TIMEOUT = 10000; // 10s
