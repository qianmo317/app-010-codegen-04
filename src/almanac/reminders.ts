import { LUNAR_DAY_NAMES, LUNAR_MONTH_NAMES } from './constants';
import {
  getLunarLeapMonth,
  getLunarMonthLength,
  getSolarTerm,
  lunarToSolar,
} from './lunar';
import { formatDate, gregorianToJDN } from '../utils/date';

export type ReminderKind = 'birthday' | 'memorial';
export type LeapMode = 'normal' | 'leap';
export type DeliveryStatus = 'sent' | 'failed' | 'manual';

export interface ReminderEntry {
  id: string;
  name: string;
  kind: ReminderKind;
  month: number;
  day: number;
  leap: LeapMode;
  priority: number;
  createdAt: number;
}

export interface ReminderOccurrence {
  entry: ReminderEntry;
  key: string;
  solarYear: number;
  solarMonth: number;
  solarDay: number;
  dateKey: string;
  lunarYear: number;
  daysRemaining: number;
  lunarLabel: string;
  leapLabel: string;
  leapAvailable: boolean;
  adjustedDay: boolean;
  intendedDay: number;
  solarTerm?: string;
  order: number;
}

export interface DeliveryRecord {
  status: DeliveryStatus;
  at: string;
  message?: string;
}

export interface ReminderStore {
  entries: ReminderEntry[];
  leadDays: number;
  deliveries: Record<string, DeliveryRecord>;
}

export const DEFAULT_LEAD_DAYS = 7;

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export function todayParts(date: Date = new Date()): [number, number, number] {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

export function validateReminderInput(input: Pick<ReminderEntry, 'name' | 'kind' | 'month' | 'day' | 'leap' | 'priority'>): string | null {
  if (!input.name.trim()) return '请填写称呼';
  if (input.kind !== 'birthday' && input.kind !== 'memorial') return '请选择生日或祭日';
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) return '农历月份应为 1-12';
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 30) return '农历日期应为初一至三十';
  if (input.leap !== 'normal' && input.leap !== 'leap') return '请选择按平常月还是闰月';
  if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 999) return '先后次序应为 1-999';
  return null;
}

export function defaultPriority(kind: ReminderKind): number {
  return kind === 'memorial' ? 10 : 20;
}

export function createReminderEntry(input: Omit<ReminderEntry, 'id' | 'createdAt' | 'priority'> & Partial<Pick<ReminderEntry, 'priority'>>): ReminderEntry {
  return {
    id: createId(),
    name: input.name.trim(),
    kind: input.kind,
    month: input.month,
    day: input.day,
    leap: input.leap,
    priority: input.priority ?? defaultPriority(input.kind),
    createdAt: Date.now(),
  };
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function lunarDateLabel(month: number, day: number, leap: LeapMode): string {
  const monthName = LUNAR_MONTH_NAMES[month - 1];
  const dayName = LUNAR_DAY_NAMES[day - 1];
  return `${leap === 'leap' ? '闰' : ''}${monthName}月${dayName}`;
}

export function deliveryKey(entryId: string, dateKey: string): string {
  return `${entryId}@${dateKey}`;
}

export function findNextOccurrence(entry: ReminderEntry, today: Date = new Date()): ReminderOccurrence | null {
  const [todayYear, todayMonth, todayDay] = todayParts(today);
  const todayJdn = gregorianToJDN(todayYear, todayMonth, todayDay);

  // 公历年初可能仍属上一农历年，所以从去年开始扫描。
  for (let lunarYear = todayYear - 1; lunarYear <= MAX_YEAR; lunarYear++) {
    if (lunarYear < MIN_YEAR) continue;

    const leapMonth = getLunarLeapMonth(lunarYear);
    if (entry.leap === 'leap' && leapMonth !== entry.month) continue;

    const monthLength = getLunarMonthLength(lunarYear, entry.month, entry.leap === 'leap');
    if (monthLength === null) continue;

    const actualDay = Math.min(entry.day, monthLength);
    const [solarYear, solarMonth, solarDay] = lunarToSolar(
      lunarYear,
      entry.month,
      actualDay,
      entry.leap === 'leap',
    );
    const jdn = gregorianToJDN(solarYear, solarMonth, solarDay);
    if (jdn < todayJdn) continue;

    const dateKey = formatDate(solarYear, solarMonth, solarDay);
    const monthName = LUNAR_MONTH_NAMES[entry.month - 1];
    const leapAvailable = leapMonth === entry.month;
    let leapLabel: string;
    if (entry.leap === 'leap') {
      leapLabel = `今年轮上闰${monthName}月，本条按闰${monthName}月办`;
    } else if (leapAvailable) {
      leapLabel = `今年有闰${monthName}月，本条按平常${monthName}月办`;
    } else {
      leapLabel = `今年没有闰${monthName}月，按平常${monthName}月办`;
    }

    return {
      entry,
      key: deliveryKey(entry.id, dateKey),
      solarYear,
      solarMonth,
      solarDay,
      dateKey,
      lunarYear,
      daysRemaining: jdn - todayJdn,
      lunarLabel: lunarDateLabel(entry.month, entry.day, entry.leap),
      leapLabel,
      leapAvailable,
      adjustedDay: entry.day > monthLength,
      intendedDay: entry.day,
      solarTerm: getSolarTerm(solarYear, solarMonth, solarDay),
      order: 0,
    };
  }

  return null;
}

export function getReminderOccurrences(entries: ReminderEntry[], today: Date = new Date()): ReminderOccurrence[] {
  return entries
    .map(entry => findNextOccurrence(entry, today))
    .filter((item): item is ReminderOccurrence => item !== null)
    .sort((a, b) => {
      if (a.daysRemaining !== b.daysRemaining) return a.daysRemaining - b.daysRemaining;
      if (a.entry.priority !== b.entry.priority) return a.entry.priority - b.entry.priority;
      if (a.entry.createdAt !== b.entry.createdAt) return a.entry.createdAt - b.entry.createdAt;
      return a.entry.id.localeCompare(b.entry.id);
    })
    .map((item, index) => ({ ...item, order: index + 1 }));
}

export function groupCollisions(occurrences: ReminderOccurrence[]): Map<string, ReminderOccurrence[]> {
  const groups = new Map<string, ReminderOccurrence[]>();
  for (const occurrence of occurrences) {
    const list = groups.get(occurrence.dateKey) ?? [];
    list.push(occurrence);
    groups.set(occurrence.dateKey, list);
  }
  return groups;
}

export function getDueOccurrences(occurrences: ReminderOccurrence[], leadDays: number): ReminderOccurrence[] {
  return occurrences.filter(item => item.daysRemaining <= leadDays);
}

export function formatDaysRemaining(days: number): string {
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `还剩 ${days} 天`;
}

export function occurrenceTitle(item: ReminderOccurrence): string {
  const kindLabel = item.entry.kind === 'birthday' ? '农历生日' : '祭日';
  return `${item.entry.name}${kindLabel}：${formatDaysRemaining(item.daysRemaining)}`;
}

export function occurrenceBody(item: ReminderOccurrence): string {
  const lines = [
    `${item.dateKey}（${item.lunarLabel}）`,
    item.leapLabel,
  ];
  if (item.adjustedDay) {
    lines.push(`今年该月只有廿九，三十依本月最后一天办理`);
  }
  if (item.entry.day === 1 || item.entry.day === 15) {
    lines.push(item.solarTerm ? `今年此日恰逢${item.solarTerm}` : '今年此日未逢节气');
  }
  return lines.join('\n');
}
