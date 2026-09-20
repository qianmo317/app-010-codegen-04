import { describe, expect, it } from 'vitest';
import {
  ReminderEntry,
  createReminderEntry,
  findNextOccurrence,
  formatDaysRemaining,
  getDueOccurrences,
  getReminderOccurrences,
  occurrenceBody,
  validateReminderInput,
} from './reminders';
import { lunarToSolar, solarToLunar } from './lunar';

function makeEntry(overrides: Partial<ReminderEntry> = {}): ReminderEntry {
  return {
    id: overrides.id ?? 'entry-1',
    name: overrides.name ?? '父亲',
    kind: overrides.kind ?? 'birthday',
    month: overrides.month ?? 6,
    day: overrides.day ?? 15,
    leap: overrides.leap ?? 'normal',
    priority: overrides.priority ?? 20,
    createdAt: overrides.createdAt ?? 1,
  };
}

describe('农历提醒换算', () => {
  it('把农历月日换算成当年或下一农历年的公历日期', () => {
    const today = new Date(2026, 8, 20);
    const occurrence = findNextOccurrence(makeEntry({ month: 6, day: 15 }), today);

    expect(occurrence).not.toBeNull();
    expect(occurrence?.lunarYear).toBe(2027);
    expect(occurrence?.daysRemaining).toBeGreaterThan(0);
    expect(lunarToSolar(2027, 6, 15)).toEqual([
      occurrence?.solarYear,
      occurrence?.solarMonth,
      occurrence?.solarDay,
    ]);
  });

  it('今天及未过的日子保留在本年，已过的自动翻到下一年', () => {
    const today = new Date(2026, 1, 17); // 2026-02-17，农历2026年正月初一
    const todayOccurrence = findNextOccurrence(makeEntry({ id: 'today', month: 1, day: 1 }), today);
    const pastOccurrence = findNextOccurrence(makeEntry({ id: 'past', month: 1, day: 1 }), new Date(2026, 1, 18));

    expect(todayOccurrence?.lunarYear).toBe(2026);
    expect(todayOccurrence?.daysRemaining).toBe(0);
    expect(formatDaysRemaining(0)).toBe('今天');
    expect(pastOccurrence?.lunarYear).toBe(2027);
    expect(pastOccurrence?.daysRemaining).toBeGreaterThan(0);
  });

  it('平常月记录在闰月年仍选择平常月，并说明两种月的区别', () => {
    const today = new Date(2025, 6, 1);
    const normal = findNextOccurrence(makeEntry({ month: 2, day: 15, leap: 'normal' }), today);
    const leap = findNextOccurrence(makeEntry({ id: 'leap', month: 2, day: 15, leap: 'leap' }), today);

    expect(normal?.lunarYear).toBe(2026);
    expect(normal?.dateKey).toBe('2026-04-02');
    expect(normal?.leapLabel).toContain('按平常');

    const beforeLeapMonth = findNextOccurrence(makeEntry({ month: 2, day: 15, leap: 'normal' }), new Date(2023, 0, 1));
    expect(beforeLeapMonth?.dateKey).toBe('2023-03-07');
    expect(beforeLeapMonth?.leapLabel).toContain('今年有闰二月');

    expect(leap?.lunarYear).toBeGreaterThan(2025);
    expect(leap?.leapLabel).toContain('按闰二月');
  });

  it('农历三十遇小月自动落在廿九并标明调整', () => {
    const occurrence = findNextOccurrence(
      makeEntry({ id: 'small-month', month: 1, day: 30 }),
      new Date(2025, 0, 1),
    );

    expect(occurrence?.lunarYear).toBe(2025);
    expect(occurrence?.dateKey).toBe('2025-02-26');
    expect(occurrence?.adjustedDay).toBe(true);
    expect(occurrence?.intendedDay).toBe(30);
  });
});

describe('提醒排序与提醒期', () => {
  it('同一天按优先级再按创建时间排出先后', () => {
    const entries = [
      makeEntry({ id: 'late', name: '晚辈生日', kind: 'birthday', month: 7, day: 20, priority: 20, createdAt: 1 }),
      makeEntry({ id: 'elder', name: '长辈祭日', kind: 'memorial', month: 7, day: 20, priority: 10, createdAt: 2 }),
      makeEntry({ id: 'same-priority', name: '同辈生日', kind: 'birthday', month: 7, day: 20, priority: 10, createdAt: 3 }),
    ];

    const occurrences = getReminderOccurrences(entries, new Date(2026, 8, 20));
    const firstDate = occurrences[0].dateKey;
    const sameDay = occurrences.filter(item => item.dateKey === firstDate);

    expect(sameDay.map(item => item.entry.id)).toEqual(['elder', 'same-priority', 'late']);
  });

  it('按提前天数筛选待发提醒', () => {
    const today = new Date(2026, 8, 20);
    const nearLunar = solarToLunar(2026, 9, 25);
    const farLunar = solarToLunar(2026, 11, 1);
    const entries = [
      makeEntry({ id: 'near', name: '近', month: nearLunar.month, day: nearLunar.day, leap: nearLunar.isLeap ? 'leap' : 'normal' }),
      makeEntry({ id: 'far', name: '远', month: farLunar.month, day: farLunar.day, leap: farLunar.isLeap ? 'leap' : 'normal' }),
    ];
    const occurrences = getReminderOccurrences(entries, today);
    const due = getDueOccurrences(occurrences, 7);

    expect(due.map(item => item.entry.id)).toContain('near');
    expect(due.map(item => item.entry.id)).not.toContain('far');
  });
});

describe('提示文案和输入校验', () => {
  it('为初一、十五标出当年是否恰逢节气', () => {
    const body = occurrenceBody(findNextOccurrence(makeEntry({ month: 1, day: 15 }), new Date(2026, 8, 20))!);
    expect(body).toMatch(/节气/);
  });

  it('拒绝无效农历月日', () => {
    expect(validateReminderInput({
      name: '',
      kind: 'birthday',
      month: 13,
      day: 1,
      leap: 'normal',
      priority: 20,
    })).not.toBeNull();
    expect(validateReminderInput({
      name: '父亲',
      kind: 'birthday',
      month: 1,
      day: 31,
      leap: 'normal',
      priority: 20,
    })).not.toBeNull();
  });

  it('创建记录时按类别补默认先后次序', () => {
    expect(createReminderEntry({ name: '祖母', kind: 'memorial', month: 1, day: 1, leap: 'normal' }).priority).toBe(10);
    expect(createReminderEntry({ name: '孩子', kind: 'birthday', month: 1, day: 1, leap: 'normal' }).priority).toBe(20);
  });
});
