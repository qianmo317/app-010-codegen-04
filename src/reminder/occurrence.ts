// 把「农历某月某日」换算成实际公历发生日
//
// 建模：一个农历年（正月→腊月，含闰月）产出「至多一次」发生。
// 农历年与公历年错位：正月可能在公历 1 月、腊月可能进入公历次年 1-2 月、
// 闰冬月/闰腊月更会溢出到公历次年。因此枚举时以农历年为准，再投影到公历，
// 不按公历年强行归并，避免漏掉「一个公历年内出现两次」或「上一轮被当本轮」。
import { LUNAR_YEAR_DATA } from '../data/lunar-data';
import { lunarToSolar, solarToLunar } from '../almanac/lunar';
import { LUNAR_MONTH_NAMES, LUNAR_DAY_NAMES } from '../almanac/constants';
import { gregorianToJDN } from '../utils/date';
import type { Occurrence, ReminderEntry } from './types';

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

export function lunarMonthName(m: number, isLeap: boolean): string {
  return (isLeap ? '闰' : '') + LUNAR_MONTH_NAMES[m - 1] + '月';
}

export function lunarDayName(d: number): string {
  return LUNAR_DAY_NAMES[d - 1];
}

// 某农历年某月天数；isLeap 取该年闰月（无闰返回 0）
export function getLunarMonthDays(lunarYear: number, month: number, isLeap: boolean): number {
  if (lunarYear < MIN_YEAR || lunarYear > MAX_YEAR) return 0;
  const data = LUNAR_YEAR_DATA[lunarYear - MIN_YEAR];
  if (isLeap) return data.lm === month ? data.ld : 0;
  return data.md[month - 1];
}

// 该农历年是否闰指定月
export function yearHasLeapMonth(lunarYear: number, month: number): boolean {
  if (lunarYear < MIN_YEAR || lunarYear > MAX_YEAR) return false;
  return LUNAR_YEAR_DATA[lunarYear - MIN_YEAR].lm === month;
}

function lunarToSolarSafe(lunarYear: number, month: number, day: number, isLeap: boolean) {
  if (lunarYear < MIN_YEAR || lunarYear > MAX_YEAR) return null;
  try {
    const [sy, sm, sd] = lunarToSolar(lunarYear, month, day, isLeap);
    return { sy, sm, sd };
  } catch {
    return null;
  }
}

// 一个农历年里，一条记录对应的那次发生（已处理闰月取舍与「三十」回落）
export function occurrenceForLunarYear(entry: ReminderEntry, lunarYear: number): Occurrence | null {
  if (lunarYear < MIN_YEAR || lunarYear > MAX_YEAR) return null;

  const hasLeap = yearHasLeapMonth(lunarYear, entry.lunarMonth);
  let useLeap = false;
  let leapNote: string | null = null;

  if (entry.leapMode === 'leap') {
    if (hasLeap) {
      useLeap = true;
    } else {
      useLeap = false;
      leapNote = `农历${lunarYear}年不闰${LUNAR_MONTH_NAMES[entry.lunarMonth - 1]}月，按平常${lunarMonthName(entry.lunarMonth, false)}办`;
    }
  } else {
    useLeap = false;
    if (hasLeap) {
      leapNote = `农历${lunarYear}年有闰${LUNAR_MONTH_NAMES[entry.lunarMonth - 1]}月，本条按平常${lunarMonthName(entry.lunarMonth, false)}办；若闰月也要办请再记一条「按闰月」`;
    }
  }

  let day = entry.lunarDay;
  let dayClamped = false;
  if (day === 30) {
    const monthDays = getLunarMonthDays(lunarYear, entry.lunarMonth, useLeap);
    if (monthDays === 29) {
      day = 29;
      dayClamped = true;
      const clampNote = `农历${lunarYear}年${lunarMonthName(entry.lunarMonth, useLeap)}是小月，没有三十，按${lunarDayName(29)}办`;
      leapNote = leapNote ? `${leapNote}；${clampNote}` : clampNote;
    }
  }

  const solar = lunarToSolarSafe(lunarYear, entry.lunarMonth, day, useLeap);
  if (!solar) return null;

  // 闰月溢出到下一个公历年时补一句说明（如农历 2033 闰冬月 → 公历 2034-01）
  if (useLeap && solar.sy !== lunarYear) {
    const spill = `按闰月办：该闰月已轮入公历${solar.sy}年`;
    leapNote = leapNote ? `${leapNote}；${spill}` : spill;
  }

  return {
    entry,
    solarYear: solar.sy,
    solarMonth: solar.sm,
    solarDay: solar.sd,
    lunarYear,
    isLeap: useLeap,
    leapNote,
    dayClamped
  };
}

// 落在指定公历年内的全部发生（一般 1 次；腊月类条目可能年初一次、年末一次）
export function resolveOccurrencesInSolarYear(entry: ReminderEntry, solarYear: number): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ly of [solarYear - 1, solarYear, solarYear + 1]) {
    const o = occurrenceForLunarYear(entry, ly);
    if (o && o.solarYear === solarYear) out.push(o);
  }
  out.sort((a, b) => gregorianToJDN(a.solarYear, a.solarMonth, a.solarDay) - gregorianToJDN(b.solarYear, b.solarMonth, b.solarDay));
  return out;
}

export function occurrenceDateStr(o: Occurrence): string {
  return `${o.solarYear}-${String(o.solarMonth).padStart(2, '0')}-${String(o.solarDay).padStart(2, '0')}`;
}

export function jdnOfOccurrence(o: Occurrence): number {
  return gregorianToJDN(o.solarYear, o.solarMonth, o.solarDay);
}

export function dateToJdn(d: Date): number {
  return gregorianToJDN(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// 从某日起下一次还没过的发生（今天当天算「还没过」，剩 0 天）。按农历年枚举。
export function resolveNextOccurrence(entry: ReminderEntry, from: Date): Occurrence | null {
  const todayJdn = dateToJdn(from);
  // 今天所属的农历年；从它开始逐个农历年往后找
  let lunarYear = solarToLunar(from.getFullYear(), from.getMonth() + 1, from.getDate()).year;
  while (lunarYear <= MAX_YEAR) {
    const o = occurrenceForLunarYear(entry, lunarYear);
    if (o && jdnOfOccurrence(o) >= todayJdn) return o;
    lunarYear++;
  }
  return null;
}
