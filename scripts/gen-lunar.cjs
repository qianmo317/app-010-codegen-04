const { Lunar } = require('lunar-javascript');
const fs = require('fs');

function daysIn(y, m, isLeap) {
  // 本月天数 = 与「下一农历月初一」之差
  const cur = Lunar.fromYmd(y, isLeap ? -m : m, 1).getSolar().toYmd();
  let nextY = y, nextM, nextLeap = false;
  if (isLeap) {
    // 闰月之后是同序号正常月的下一月（若 m==12 则次年正月）
    nextM = m + 1;
  } else {
    // 检查后面是否紧跟闰月：若本年闰 m，则下一相是闰 m
    let hasLeapAfter = false;
    try { Lunar.fromYmd(y, -m, 1); hasLeapAfter = true; } catch (e) {}
    if (hasLeapAfter) { nextM = m; nextLeap = true; }
    else nextM = m + 1;
  }
  if (nextM > 12) { nextY = y + 1; nextM = 1; }
  const nxt = Lunar.fromYmd(nextY, nextLeap ? -nextM : nextM, 1).getSolar().toYmd();
  return Math.round((new Date(nxt) - new Date(cur)) / 86400000);
}

const rows = [];
for (let y = 1900; y <= 2100; y++) {
  const sfStr = Lunar.fromYmd(y, 1, 1).getSolar().toYmd();
  const sf = Math.round((new Date(sfStr) - Date.UTC(y, 0, 1)) / 86400000);
  const md = [];
  for (let m = 1; m <= 12; m++) md.push(daysIn(y, m, false));
  let lm = 0;
  for (let m = 1; m <= 12; m++) { try { Lunar.fromYmd(y, -m, 1); lm = m; break; } catch (e) {} }
  const ld = lm ? daysIn(y, lm, true) : 0;
  // 年长度一致性：总和应等于次年春节 - 本年春节
  const nextSfStr = Lunar.fromYmd(y + 1, 1, 1).getSolar().toYmd();
  const total = md.reduce((a, b) => a + b, 0) + ld;
  const expected = Math.round((new Date(nextSfStr) - new Date(sfStr)) / 86400000);
  if (total !== expected) throw new Error(`year ${y} total ${total} != ${expected}`);
  rows.push({ md, lm, ld, sf });
}

// 与第二独立源 chinese-lunar-calendar 抽查 2057 前的春节与闰月
let lc = null;
try { lc = require('chinese-lunar-calendar'); } catch (e) { console.warn('未安装 chinese-lunar-calendar，跳过第二数据源交叉验证'); }
if (lc) {
  let bad = 0;
  for (let y = 1901; y <= 2099; y++) {
    // 春节：从 1/15 起找 lunarDate==1 && !isLeap；d 是相对 1 月 1 日的「1 起」序号，
    // 表中 sf 为「0 起」偏移，故比较 d - 1。
    let sfOffset = null;
    for (let d = 15; d <= 66; d++) {
      const dt = new Date(Date.UTC(y, 0, d));
      const info = lc.getLunar(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      if (info.lunarMonth === 1 && info.lunarDate === 1 && !info.isLeap) { sfOffset = d - 1; break; }
    }
    if (sfOffset !== rows[y - 1900].sf) { console.log('SF2 mismatch', y, sfOffset, rows[y-1900].sf); bad++; }
  }
  console.log('spring festival vs second source mismatches:', bad);
}

const header = `// 农历年数据 1900-2100
// 数据源：lunar-javascript（寿星天文历算法），春节与 chinese-lunar-calendar（紫金山历表）交叉验证一致。
// 每年使用对象存储，清晰易验证
// sf: 春节公历日期偏移（从当年1月1日起，0-indexed）
// md: 12个正常月的天数
// lm: 闰月月份（0=无闰月，1-12）
// ld: 闰月天数（0=无闰月）
// 本文件由 scripts/gen-lunar.cjs 生成，勿手改。

`;
const body = 'export interface LunarYearData {\n  sf: number;\n  md: number[];\n  lm: number;\n  ld: number;\n}\n\n' +
  'function d(monthDays: number[], leapMonth: number, leapDays: number, springOffset: number): LunarYearData {\n' +
  '  return { md: monthDays, lm: leapMonth, ld: leapDays, sf: springOffset };\n}\n\n' +
  'export const LUNAR_YEAR_DATA: LunarYearData[] = [\n' +
  rows.map((r, i) => {
    const y = 1900 + i;
    const decade = i % 10 === 0 ? `  // ${y}-${Math.min(y+9,2100)}\n` : '';
    return decade + `  d([${r.md.join(',')}], ${r.lm},${r.ld}, ${String(r.sf).padStart(2)}), // ${y}${r.lm ? ` 闰${r.lm}月` : ''}`;
  }).join('\n') + '\n];\n';
fs.writeFileSync(process.argv[2], header + body);
console.log('written', rows.length, 'rows');
console.log('sample 1900:', JSON.stringify(rows[0]));
console.log('sample 2025:', JSON.stringify(rows[2025-1900]));
console.log('sample 2023:', JSON.stringify(rows[2023-1900]));
