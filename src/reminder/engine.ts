// 提醒引擎：列出近期事项、判定到期提醒、同日撞期排序、初一/十五节气标注
import { getSolarTerm } from '../almanac/lunar';
import {
  resolveNextOccurrence, resolveOccurrencesInSolarYear, occurrenceDateStr, jdnOfOccurrence,
  dateToJdn, lunarMonthName, lunarDayName
} from './occurrence';
import type { Occurrence, ReminderEntry, ReminderRecord } from './types';

export interface DueItem {
  occurrence: Occurrence;
  daysLeft: number;
  lead: number;                 // 命中的提前提醒天数
  solarTerm: string | null;     // 初一/十五当天恰逢的节气
  collisions: CollisionInfo[];  // 同一天撞上的其他事项（已排序）
}

export interface CollisionInfo {
  entryId: string;
  name: string;
  kind: ReminderEntry['kind'];
  order: number;                // 1 = 最先
  reason: string;
}

// 同一公历日多件事的先后：
// 1) 祭日在前、生日在后（先尽哀、后祝寿）
// 2) 同类按 priority 升序
// 3) 再按姓名
export function orderEntriesForSameDay(entries: ReminderEntry[]): ReminderEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'memorial' ? -1 : 1;
    const pa = a.priority ?? 100;
    const pb = b.priority ?? 100;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
}

// 初一、十五当天恰逢节气才标注
export function termOnShuoWang(o: Occurrence): string | null {
  if (o.entry.lunarDay !== 1 && o.entry.lunarDay !== 15) return null;
  return getSolarTerm(o.solarYear, o.solarMonth, o.solarDay) ?? null;
}

// 组装一条事项的提示文案
export function describeEntry(o: Occurrence): string {
  const e = o.entry;
  const kindWord = e.kind === 'birthday' ? '生日' : '祭日';
  const ordinal = lunarMonthName(e.lunarMonth, o.isLeap) + lunarDayName(e.lunarDay === 30 && o.dayClamped ? 29 : e.lunarDay);
  const bits = [`${e.name}的${kindWord}`, `农历${ordinal}`];
  if (o.leapNote) bits.push(o.leapNote);
  return bits.join('，');
}

export interface PlannedOccurrence {
  occurrence: Occurrence;
  daysLeft: number;
  solarTerm: string | null;
}

// 计算今天起每个条目的下一次发生（已自动把过完的翻到下一年）
export function planOccurrences(entries: ReminderEntry[], today: Date): PlannedOccurrence[] {
  const todayJdn = dateToJdn(today);
  const out: PlannedOccurrence[] = [];
  for (const e of entries) {
    if (e.archived) continue;
    const o = resolveNextOccurrence(e, today);
    if (!o) continue;
    out.push({ occurrence: o, daysLeft: jdnOfOccurrence(o) - todayJdn, solarTerm: termOnShuoWang(o) });
  }
  return out;
}

// 同日分组，返回 公历日 -> 排序后条目
export function groupByDate(list: PlannedOccurrence[]): Map<string, PlannedOccurrence[]> {
  const map = new Map<string, PlannedOccurrence[]>();
  for (const item of list) {
    const key = occurrenceDateStr(item.occurrence);
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      const ordered = orderEntriesForSameDay([a.occurrence.entry, b.occurrence.entry]);
      return ordered[0].id === a.occurrence.entry.id ? -1 : 1;
    });
  }
  return map;
}

// 判定今天该发哪些提醒（daysLeft ∈ leadDays），withinDays 限定列表窗口
export function collectDueReminders(
  entries: ReminderEntry[],
  today: Date,
  alreadySentKeys: Set<string>
): { due: DueItem[]; planned: PlannedOccurrence[] } {
  const planned = planOccurrences(entries, today);
  const grouped = groupByDate(planned);
  const due: DueItem[] = [];

  for (const item of planned) {
    const lead = item.occurrence.entry.leadDays.find(l => l === item.daysLeft);
    if (lead === undefined) continue;
    const key = recordKey(item.occurrence.entry.id, occurrenceDateStr(item.occurrence), lead);
    if (alreadySentKeys.has(key)) continue; // 已成功发出/演练过的本轮不重复；失败的仍会重试

    const sameDay = grouped.get(occurrenceDateStr(item.occurrence))!;
    const ordered = orderEntriesForSameDay(sameDay.map(x => x.occurrence.entry));
    const collisions: CollisionInfo[] = sameDay.length > 1
      ? sameDay.map(x => {
          const en = x.occurrence.entry;
          const order = ordered.findIndex(o => o.id === en.id) + 1;
          const reason = en.priority !== undefined
            ? `手动权重${en.priority}`
            : (en.kind === 'memorial'
                ? '祭日优先于生日'
                : '祭日优先；同类按称呼排序');
          return { entryId: en.id, name: en.name, kind: en.kind, order, reason };
        })
      : [];

    due.push({ occurrence: item.occurrence, daysLeft: item.daysLeft, lead, solarTerm: item.solarTerm, collisions });
  }

  // 发送顺序：剩余天数升序；同一天按祭日→生日等规则
  due.sort((a, b) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    const ordered = orderEntriesForSameDay([a.occurrence.entry, b.occurrence.entry]);
    return ordered[0].id === a.occurrence.entry.id ? -1 : 1;
  });
  return { due, planned };
}

export function recordKey(entryId: string, dateStr: string, lead: number): string {
  return `${entryId}:${dateStr}:${lead}`;
}

export function buildMessage(item: DueItem): string {
  const o = item.occurrence;
  const dateStr = occurrenceDateStr(o);
  let when: string;
  if (item.daysLeft === 0) when = '就是今天';
  else if (item.daysLeft === 1) when = '就是明天';
  else when = `还有 ${item.daysLeft} 天`;
  const lines = [
    `【提醒】${describeEntry(o)}`,
    `公历 ${dateStr}，${when}（提前 ${item.lead} 天）。`
  ];
  if (item.solarTerm) lines.push(`当天恰逢节气「${item.solarTerm}」。`);
  if (o.leapNote) lines.push(o.leapNote + '。');
  if (item.collisions.length > 1) {
    const me = item.collisions.find(c => c.entryId === o.entry.id)!;
    const others = item.collisions.filter(c => c.entryId !== o.entry.id)
      .map(c => `${c.name}${c.kind === 'memorial' ? '祭日' : '生日'}`).join('、');
    lines.push(`同一天还撞上：${others}。排序：本日第 ${me.order}/${item.collisions.length} 件（祭日优先、生日在后）。`);
  }
  return lines.join('\n');
}

// 供「今年全年预览」用：取条目在指定公历年的全部发生（腊月类可能年初、年末各一次）
export function previewYear(entries: ReminderEntry[], solarYear: number) {
  const rows: Array<{ entry: ReminderEntry; occurrence: Occurrence; solarTerm: string | null }> = [];
  for (const e of entries) {
    if (e.archived) continue;
    for (const occurrence of resolveOccurrencesInSolarYear(e, solarYear)) {
      rows.push({ entry: e, occurrence, solarTerm: termOnShuoWang(occurrence) });
    }
  }
  return rows;
}

export type { ReminderRecord };
