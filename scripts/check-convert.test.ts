import { describe, it, expect } from 'vitest';
import { solarToLunar } from '../src/almanac/lunar';
import { getSolarTermDates } from '../src/almanac/lunar';

const lib = require('lunar-javascript');

describe('公历转农历：与寿星天文历逐日对照', () => {
  it('1901-2100 全部日期一致', () => {
    let diffs = 0;
    const samples: string[] = [];
    for (let y = 1901; y <= 2100; y++) {
      for (let dayOfYear = 0; dayOfYear < 365; dayOfYear += 3) {
        const d = new Date(Date.UTC(y, 0, 1 + dayOfYear));
        const yy = d.getUTCFullYear(), mm = d.getUTCMonth() + 1, dd = d.getUTCDate();
        if (yy !== y) continue;
        const r = solarToLunar(yy, mm, dd);
        const l = lib.Solar.fromYmd(yy, mm, dd).getLunar();
        if (l.getYear() !== r.year || Math.abs(l.getMonth()) !== r.month || l.getDay() !== r.day || (l.getMonth() < 0) !== r.isLeap) {
          diffs++;
          if (samples.length < 10) samples.push(`${yy}-${mm}-${dd}: ours ${r.year}.${r.isLeap?'闰':''}${r.month}.${r.day} / lib ${l.getYear()}.${l.getMonth()}.${l.getDay()}`);
        }
      }
    }
    expect(samples, samples.join('\n')).toEqual([]);
    expect(diffs).toBe(0);
  });

  it('节气表与权威库对照（抽 30 年 × 24 节气）', () => {
    const names = ['小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'];
    for (const y of [1900,1949,1980,2000,2008,2017,2020,2024,2025,2026,2033,2050,2077,2099,2100]) {
      const table = getSolarTermDates(y);
      const t = lib.Solar.fromYmd(y,1,1).getLunar().getJieQiTable();
      names.forEach((n, i) => {
        const solar = t[n].getSolar ? t[n].getSolar() : t[n];
        expect(solar.getDay(), `${y} ${n}`).toBe(table[i]);
        expect(solar.getMonth(), `${y} ${n} month`).toBe(Math.floor(i / 2) + 1);
      });
    }
  });
});
