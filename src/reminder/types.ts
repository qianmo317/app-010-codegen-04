// 农历生日 / 祭日提醒 —— 数据类型

// 事项种类：生日与祭日分开列
export type EntryKind = 'birthday' | 'memorial';

// 闰月处理方式：
// - normal：只按平常那个月过（即使当年轮上闰月）
// - leap：只按闰月过（当年没有闰这个月时自动回落到平常月，并在提示里说明）
// - both：两种都过 —— 录入时请各记一条（normal + leap），这里不做隐式展开
export type LeapMode = 'normal' | 'leap';

export interface ReminderEntry {
  id: string;
  kind: EntryKind;
  name: string;            // 家里人 / 老人的称呼
  lunarMonth: number;      // 农历月 1-12（正月=1，腊月=12）
  lunarDay: number;        // 农历日 1-30
  leapMode: LeapMode;      // 轮上闰月时按闰月还是平常月
  leadDays: number[];      // 提前几天提醒，如 [7, 3, 0]（0 = 当天）
  priority?: number;       // 同一天撞上两件事时的手动排序权重，小者在前；默认按规则排
  note?: string;
  createdAt: string;       // ISO 时间戳
  archived?: boolean;
}

// 一条事项在某公历年里的一次「发生」
export interface Occurrence {
  entry: ReminderEntry;
  solarYear: number;       // 落到的公历年
  solarMonth: number;
  solarDay: number;
  lunarYear: number;       // 对应的农历年
  isLeap: boolean;         // 本次实际按闰月还是平常月
  leapNote: string | null; // 闰月取舍 / 无闰回落 / 三十回落说明
  dayClamped: boolean;     // 农历三十在小月回落为廿九
}

// 提醒发送状态：发没发出去都留个记号
export interface ReminderRecord {
  // key = `${entryId}:${yyyy-MM-dd}:${lead}`
  key: string;
  entryId: string;
  occurrenceDate: string;  // yyyy-MM-dd
  lead: number;
  status: 'sent' | 'failed' | 'dry-run';
  channel: string;         // 'in-app' | 'web-notification' | 自定义发送器名
  message: string;
  at: string;              // ISO 时间戳
  error?: string;
}

export interface ReminderStoreData {
  version: 1;
  entries: ReminderEntry[];
  records: ReminderRecord[];
}
