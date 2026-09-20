import { describe, expect, it, beforeAll } from 'vitest';
import { ReminderEntry, createReminderEntry, getReminderOccurrences } from '../almanac/reminders';
import { sendDueReminders } from './notifications';

function entry(): ReminderEntry {
  return createReminderEntry({
    name: '父亲',
    kind: 'birthday',
    month: 8,
    day: 15,
    leap: 'normal',
  });
}

function storeWithOccurrence() {
  const entries = [entry()];
  const occurrences = getReminderOccurrences(entries, new Date(2026, 8, 20));
  return { entries, occurrence: occurrences[0] };
}

describe('发送提醒并留痕', () => {
  beforeAll(() => {
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => memory.set(key, value),
        removeItem: (key: string) => memory.delete(key),
        clear: () => memory.clear(),
      },
      configurable: true,
    });
  });

  it('通知发出后按“条目+公历日期”记录已发送，避免重复发送', () => {
    const { entries, occurrence } = storeWithOccurrence();
    const sent: string[] = [];
    const notifier = {
      permission: 'granted' as const,
      requestPermission: async () => 'granted' as const,
      notify: (title: string) => sent.push(title),
    };

    const first = sendDueReminders([occurrence], { entries, leadDays: 30, deliveries: {} }, notifier);
    const second = sendDueReminders([occurrence], first, notifier);

    expect(sent).toHaveLength(1);
    expect(first.deliveries[occurrence.key]?.status).toBe('sent');
    expect(second.deliveries[occurrence.key]?.status).toBe('sent');
  });

  it('尚未授权时留下未发出记录', () => {
    const { entries, occurrence } = storeWithOccurrence();
    const result = sendDueReminders(
      [occurrence],
      { entries, leadDays: 30, deliveries: {} },
      { permission: 'default', requestPermission: async () => 'default' as const, notify: () => {} },
    );

    expect(result.deliveries[occurrence.key]?.status).toBe('failed');
    expect(result.deliveries[occurrence.key]?.message).toContain('default');
  });

  it('浏览器不支持通知时留下失败原因', () => {
    const { entries, occurrence } = storeWithOccurrence();
    const result = sendDueReminders(
      [occurrence],
      { entries, leadDays: 30, deliveries: {} },
      { permission: 'unsupported', requestPermission: async () => 'unsupported' as const, notify: () => {} },
    );

    expect(result.deliveries[occurrence.key]?.status).toBe('failed');
    expect(result.deliveries[occurrence.key]?.message).toContain('不支持');
  });
});
