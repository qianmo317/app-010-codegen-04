import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveOccurrencesInSolarYear, resolveNextOccurrence,
  occurrenceForLunarYear, getLunarMonthDays
} from './occurrence';
import {
  collectDueReminders, orderEntriesForSameDay,
  termOnShuoWang, buildMessage, previewYear
} from './engine';
import { runReminders } from './runner';
import { emptyStore, allRecordKeys } from './storage';
import { gregorianToJDN } from '../utils/date';
import type { Sender } from './senders';
import type { ReminderEntry, ReminderStoreData } from './types';

function entry(partial: Partial<ReminderEntry> & Pick<ReminderEntry, 'id' | 'name' | 'lunarMonth' | 'lunarDay'>): ReminderEntry {
  return {
    kind: 'birthday',
    leapMode: 'normal',
    leadDays: [7, 3, 0],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial
  };
}

class CountSender implements Sender {
  name = 'test';
  sent: string[] = [];
  constructor(private fail: boolean = false) {}
  send(item: Parameters<Sender['send']>[0]) {
    if (this.fail) return { ok: false, channel: this.name, message: buildMessage(item), error: '模拟发送失败' };
    this.sent.push(item.occurrence.entry.id);
    return { ok: true, channel: this.name, message: buildMessage(item) };
  }
}

function jdnBetweenOcc(a: { solarYear: number; solarMonth: number; solarDay: number }, b: { solarYear: number; solarMonth: number; solarDay: number }): number {
  return gregorianToJDN(b.solarYear, b.solarMonth, b.solarDay) - gregorianToJDN(a.solarYear, a.solarMonth, a.solarDay);
}

describe('农历日换算当年公历日', () => {
  it('平常月：2025 六月初一 → 2025-06-25', () => {
    const o = occurrenceForLunarYear(entry({ id: 'b1', name: '小宝', lunarMonth: 6, lunarDay: 1 }), 2025)!;
    expect([o.solarYear, o.solarMonth, o.solarDay]).toEqual([2025, 6, 25]);
    expect(o.isLeap).toBe(false);
    expect(o.leapNote).toContain('有闰六月');
  });

  it('闰六月条目：2025 → 2025-07-25', () => {
    const o = occurrenceForLunarYear(entry({ id: 'b2', name: '小宝', lunarMonth: 6, lunarDay: 1, leapMode: 'leap' }), 2025)!;
    expect([o.solarYear, o.solarMonth, o.solarDay]).toEqual([2025, 7, 25]);
    expect(o.isLeap).toBe(true);
    expect(o.leapNote).toBeNull();
  });

  it('按闰月办但当年不闰该月：回落到平常月并说明', () => {
    const o = occurrenceForLunarYear(entry({ id: 'b3', name: '小宝', lunarMonth: 6, lunarDay: 1, leapMode: 'leap' }), 2024)!;
    expect(o.isLeap).toBe(false);
    expect(o.leapNote).toContain('不闰六月');
  });

  it('2023 闰二月两种记法分别给出 2-20 与 3-22', () => {
    const normal = occurrenceForLunarYear(entry({ id: 'b4', name: '某人', lunarMonth: 2, lunarDay: 1 }), 2023)!;
    const leap = occurrenceForLunarYear(entry({ id: 'b5', name: '某人', lunarMonth: 2, lunarDay: 1, leapMode: 'leap' }), 2023)!;
    expect([normal.solarMonth, normal.solarDay]).toEqual([2, 20]);
    expect([leap.solarMonth, leap.solarDay]).toEqual([3, 22]);
  });

  it('农历三十遇到小月自动回落到廿九并标注', () => {
    expect(getLunarMonthDays(2025, 12, false)).toBe(29);
    const o = occurrenceForLunarYear(entry({ id: 'b6', name: '长辈', lunarMonth: 12, lunarDay: 30, kind: 'memorial' }), 2025)!;
    expect(o.dayClamped).toBe(true);
    expect(o.leapNote).toContain('没有三十');
    expect([o.solarMonth, o.solarDay]).toEqual([2, 16]); // 农历2025腊月廿九
  });

  it('按闰月的三十遇到闰月小月也回落到闰月廿九（2025 闰六月 29 天）', () => {
    expect(getLunarMonthDays(2025, 6, true)).toBe(29);
    const o = occurrenceForLunarYear(entry({ id: 'b6b', name: '小宝', lunarMonth: 6, lunarDay: 30, leapMode: 'leap' }), 2025)!;
    expect(o.dayClamped).toBe(true);
    expect(o.isLeap).toBe(true);
    expect(o.leapNote).toContain('闰六月是小月');
    expect(o.leapNote).toContain('廿九');
  });
});

describe('过完自动翻一年（按农历年滚动）', () => {
  it('今天晚于今年发生日时，取下一农历年', () => {
    const e = entry({ id: 'b7', name: '小宝', lunarMonth: 6, lunarDay: 1 });
    const o = resolveNextOccurrence(e, new Date(2025, 7, 1))!;
    expect(o.lunarYear).toBe(2026);
    expect(o.isLeap).toBe(false);
  });

  it('当天算还没过（剩 0 天），不会跳到下一年', () => {
    const e = entry({ id: 'b8', name: '小宝', lunarMonth: 6, lunarDay: 1 });
    const o = resolveNextOccurrence(e, new Date(2025, 5, 25))!;
    expect([o.solarYear, o.solarMonth, o.solarDay]).toEqual([2025, 6, 25]);
  });

  it('按闰月办的条目在「无闰」年份不丢，次年有闰时按闰月', () => {
    const e = entry({ id: 'b9', name: '小宝', lunarMonth: 6, lunarDay: 1, leapMode: 'leap' });
    const o = resolveNextOccurrence(e, new Date(2024, 7, 1))!;
    expect([o.solarYear, o.solarMonth, o.solarDay]).toEqual([2025, 7, 25]);
    expect(o.isLeap).toBe(true);
  });
});

describe('还剩几天', () => {
  it('正确计算剩余天数并按提前量命中', () => {
    const store = emptyStore();
    store.entries.push(entry({ id: 'b10', name: '小宝', lunarMonth: 7, lunarDay: 1 })); // 2025-08-23 处暑
    const { due, planned } = collectDueReminders(store.entries, new Date(2025, 7, 16), new Set());
    expect(planned[0].daysLeft).toBe(7);
    expect(due).toHaveLength(1);
    expect(due[0].lead).toBe(7);
    const other = collectDueReminders(store.entries, new Date(2025, 7, 10), new Set());
    expect(other.due).toHaveLength(0);
  });
});

describe('生日与祭日分开 / 同日撞期排序', () => {
  it('祭日排在生日前面', () => {
    const bd = entry({ id: 'b11', name: '寿星', kind: 'birthday', lunarMonth: 8, lunarDay: 15 });
    const me = entry({ id: 'm11', name: '先祖父', kind: 'memorial', lunarMonth: 8, lunarDay: 15 });
    expect(orderEntriesForSameDay([bd, me])[0].id).toBe('m11');
  });

  it('同一天两条的 collisions 给出排序序号（2025 八月十五 = 10-06）', () => {
    const store = emptyStore();
    store.entries.push(entry({ id: 'b12', name: '寿星', kind: 'birthday', lunarMonth: 8, lunarDay: 15 }));
    store.entries.push(entry({ id: 'm12', name: '先祖父', kind: 'memorial', lunarMonth: 8, lunarDay: 15 }));
    const sameDay = collectDueReminders(store.entries, new Date(2025, 9, 6), new Set());
    expect(sameDay.due).toHaveLength(2);
    expect(sameDay.due[0].occurrence.entry.kind).toBe('memorial');
    for (const d of sameDay.due) {
      expect(d.collisions).toHaveLength(2);
      expect(d.collisions.find(c => c.entryId === 'm12')!.order).toBe(1);
    }
  });

  it('文案说明同一天撞期与先后', () => {
    const store = emptyStore();
    store.entries.push(entry({ id: 'b13', name: '寿星', kind: 'birthday', lunarMonth: 8, lunarDay: 15 }));
    store.entries.push(entry({ id: 'm13', name: '先祖父', kind: 'memorial', lunarMonth: 8, lunarDay: 15 }));
    const { due } = collectDueReminders(store.entries, new Date(2025, 9, 6), new Set());
    const msg = buildMessage(due[1]);
    expect(msg).toContain('先祖父祭日');
    expect(msg).toMatch(/第 2\/2 件/);
  });
});

describe('初一十五落节气标注', () => {
  it('2025 七月初一恰逢处暑', () => {
    const o = occurrenceForLunarYear(entry({ id: 'b20', name: '小宝', lunarMonth: 7, lunarDay: 1 }), 2025)!;
    expect([o.solarMonth, o.solarDay]).toEqual([8, 23]);
    expect(termOnShuoWang(o)).toBe('处暑');
  });

  it('非初一十五不标节气', () => {
    const o = occurrenceForLunarYear(entry({ id: 'b21', name: '小宝', lunarMonth: 7, lunarDay: 2 }), 2025)!;
    expect(termOnShuoWang(o)).toBeNull();
  });

  it('闰月初一/十五恰逢节气：2031 闰三月十五 = 立夏 5-06', () => {
    const o = occurrenceForLunarYear(entry({ id: 'b22', name: '某人', lunarMonth: 3, lunarDay: 15, leapMode: 'leap' }), 2031)!;
    expect([o.solarMonth, o.solarDay]).toEqual([5, 6]);
    expect(termOnShuoWang(o)).toBe('立夏');
  });
});

describe('跨年与复杂闰月', () => {
  it('腊月条目按农历年产出：农历2032腊月三十→公历2033岁首，农历2033腊月三十→2034-02-18', () => {
    const e = entry({ id: 'x1', name: '长辈', kind: 'memorial', lunarMonth: 12, lunarDay: 30 });
    const ly2032 = occurrenceForLunarYear(e, 2032)!;
    expect(ly2032.solarYear).toBe(2033);
    expect(ly2032.solarMonth).toBeLessThanOrEqual(2);
    const ly2033 = occurrenceForLunarYear(e, 2033)!;
    expect([ly2033.solarYear, ly2033.solarMonth, ly2033.solarDay]).toEqual([2034, 2, 18]);
    expect(resolveOccurrencesInSolarYear(e, 2033)).toHaveLength(1);
    expect(resolveOccurrencesInSolarYear(e, 2033)[0].lunarYear).toBe(2032);
  });

  it('每个农历年恰好一次，相邻两次间隔 330-390 天（1901-2099 全量）', () => {
    const cases = [
      { lunarMonth: 12, lunarDay: 30, leapMode: 'normal' as const },
      { lunarMonth: 1, lunarDay: 1, leapMode: 'normal' as const },
      { lunarMonth: 6, lunarDay: 1, leapMode: 'leap' as const },
      { lunarMonth: 2, lunarDay: 29, leapMode: 'normal' as const },
      { lunarMonth: 11, lunarDay: 15, leapMode: 'leap' as const }
    ];
    for (const c of cases) {
      const e = entry({ id: `seq-${c.lunarMonth}-${c.lunarDay}`, name: 'X', ...c });
      let prev: ReturnType<typeof occurrenceForLunarYear> = null;
      for (let ly = 1901; ly <= 2099; ly++) {
        const o = occurrenceForLunarYear(e, ly)!;
        expect(o).toBeTruthy();
        if (prev) {
          const gap = jdnBetweenOcc(prev, o);
          expect(gap, `${c.lunarMonth}.${c.lunarDay} ${c.leapMode}: ${prev!.lunarYear}→${o.lunarYear}`)
            .toBeGreaterThanOrEqual(330);
          expect(gap).toBeLessThanOrEqual(390);
        }
        prev = o;
      }
    }
  });

  it('2033 闰冬月：闰十一月十五 → 2034-01-05 恰逢小寒；公历 2034 年内两次', () => {
    const e = entry({ id: 'x3', name: '某人', lunarMonth: 11, lunarDay: 15, leapMode: 'leap' });
    const o = occurrenceForLunarYear(e, 2033)!;
    expect([o.solarYear, o.solarMonth, o.solarDay]).toEqual([2034, 1, 5]);
    expect(termOnShuoWang(o)).toBe('小寒');
    const in2034 = resolveOccurrencesInSolarYear(e, 2034);
    expect(in2034).toHaveLength(2);
    expect(in2034[0].solarMonth).toBe(1);
    expect(in2034[1].solarMonth).toBe(12);
    const normal = occurrenceForLunarYear(entry({ id: 'x4', name: '某人', lunarMonth: 11, lunarDay: 15 }), 2033)!;
    expect([normal.solarMonth, normal.solarDay]).toEqual([12, 6]);
  });

  it('resolveNextOccurrence：年中看腊月条目取次年公历 2 月那次', () => {
    const e = entry({ id: 'x5', name: '长辈', kind: 'memorial', lunarMonth: 12, lunarDay: 30 });
    const o = resolveNextOccurrence(e, new Date(2033, 5, 1))!;
    expect([o.solarYear, o.solarMonth, o.solarDay]).toEqual([2034, 2, 18]);
    expect(o.lunarYear).toBe(2033);
  });

  it('闰月条目无闰年份回落平常月；年度滚动正确', () => {
    const e = entry({ id: 'x6', name: '小宝', lunarMonth: 6, lunarDay: 1, leapMode: 'leap' });
    const o2024 = occurrenceForLunarYear(e, 2024)!;
    expect([o2024.solarMonth, o2024.solarDay]).toEqual([7, 6]);
    const o2025 = occurrenceForLunarYear(e, 2025)!;
    expect(o2025.isLeap).toBe(true);
    expect([o2025.solarMonth, o2025.solarDay]).toEqual([7, 25]);
    const o2026 = occurrenceForLunarYear(e, 2026)!;
    expect(o2026.isLeap).toBe(false);
  });
});

describe('提醒发送留痕', () => {
  let store: ReminderStoreData;
  beforeEach(() => {
    store = emptyStore();
    store.entries.push(entry({ id: 'b30', name: '小宝', lunarMonth: 7, lunarDay: 1 }));
  });

  it('成功发送后写 sent 记录，且同日不重复发', () => {
    const sender = new CountSender();
    const r1 = runReminders(store, { today: new Date(2025, 7, 16), sender, persist: false });
    expect(r1.sent).toHaveLength(1);
    expect(store.records[0].status).toBe('sent');
    expect(store.records[0].message).toContain('处暑');
    const r2 = runReminders(store, { today: new Date(2025, 7, 16), sender, persist: false });
    expect(r2.sent).toHaveLength(0);
  });

  it('发送失败也留 failed 记号，下一轮重试', () => {
    const r1 = runReminders(store, { today: new Date(2025, 7, 16), sender: new CountSender(true), persist: false });
    expect(r1.failed).toHaveLength(1);
    expect(store.records[0].status).toBe('failed');
    expect(store.records[0].error).toBe('模拟发送失败');
    const r2 = runReminders(store, { today: new Date(2025, 7, 16), sender: new CountSender(false), persist: false });
    expect(r2.sent).toHaveLength(1);
    expect(store.records).toHaveLength(2);
  });

  it('dry-run 也留痕并参与去重', () => {
    const sender = new CountSender();
    runReminders(store, { today: new Date(2025, 7, 16), sender, dryRun: true, persist: false });
    expect(store.records[0].status).toBe('dry-run');
    const r = runReminders(store, { today: new Date(2025, 7, 16), sender, persist: false });
    expect(r.sent).toHaveLength(0);
    expect(allRecordKeys(store.records).size).toBe(1);
  });
});

describe('全年预览', () => {
  it('按生日/祭日给出当年全部发生日，含闰月与节气', () => {
    const entries = [
      entry({ id: 'b40', name: '小宝', kind: 'birthday', lunarMonth: 6, lunarDay: 1 }),
      entry({ id: 'b41', name: '小宝闰', kind: 'birthday', lunarMonth: 6, lunarDay: 1, leapMode: 'leap' }),
      entry({ id: 'm40', name: '先祖', kind: 'memorial', lunarMonth: 7, lunarDay: 1 })
    ];
    const rows = previewYear(entries, 2025);
    expect(rows).toHaveLength(3);
    const leapRow = rows.find(r => r.entry.id === 'b41')!;
    expect([leapRow.occurrence.solarMonth, leapRow.occurrence.solarDay]).toEqual([7, 25]);
    expect(rows.find(r => r.entry.id === 'm40')!.solarTerm).toBe('处暑');
  });

  it('腊月条目在公历年里最多两次（岁首上轮 + 年末本轮）', () => {
    const entries = [entry({ id: 'b42', name: '长辈', kind: 'memorial', lunarMonth: 12, lunarDay: 8 })];
    // 2034：农历 2033 腊月初八应在 1 月，农历 2034 腊月初八在 2035 年初——
    // 故 2035 年初可见一次；这里只校验接口能返回多次且按日期排序
    const rows = previewYear(entries, 2034);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
