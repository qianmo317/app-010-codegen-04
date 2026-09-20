const { Solar } = require('lunar-javascript');
const fs = require('fs');

// 节气顺序（公历年内，从小寒开始）
const NAMES = ['小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至',
               '小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'];

const years = [];
for (let y = 1900; y <= 2100; y++) {
  const t = Solar.fromYmd(y, 1, 1).getLunar().getJieQiTable();
  const days = NAMES.map(n => {
    const solar = t[n].getSolar ? t[n].getSolar() : t[n];
    const md = solar.toYmd(); // yyyy-MM-dd
    return Number(md.slice(8, 10));
  });
  // 安全检查：月份必须匹配（小寒1月，大寒1月...）
  const months = NAMES.map((_, i) => Math.floor(i / 2) + 1);
  const days2 = NAMES.map(n => {
    const solar = t[n].getSolar ? t[n].getSolar() : t[n];
    return Number(solar.toYmd().slice(5, 7));
  });
  for (let i = 0; i < 24; i++) if (days2[i] !== months[i]) throw new Error('month mismatch ' + y + ' ' + NAMES[i] + ' -> ' + days2[i]);
  years.push(days);
}

// 压缩：每年24个日(1-31)，用 5bit 存；一年 24*5=120bit
// 简单起见用 base32hex 分组（每 4 个节气 20bit → 一个 5 字符 base32），6组/年
function toB32(v) { return v.toString(32); } // 0..31 -> 1 char
const lines = years.map(ds => {
  let s = '';
  for (const d of ds) {
    if (d < 1 || d > 31) throw new Error('bad day');
    s += toB32(d); // 24 chars/year
  }
  return s;
});

const header = `// 二十四节气公历日期表 1900-2100
// 数据源：lunar-javascript（寿星天文历，VSOP87/ELP2000 截断项，精度分钟级）
// 编码：每年 24 个字符，依次为 小寒..冬至（公历 1-12 月每月两个），
// 每个字符为 base32 表示的「日」（1..18 用 1..9,g..i 表示；实际 1-31）。
// 本文件由 scripts/gen-jieqi.cjs 生成，勿手改；重新生成需在开发机 npm i -D lunar-javascript。

`;
const body = 'export const JIEQI_DATA: string[] = ' + JSON.stringify(lines, null, 2) + ';\n';
fs.writeFileSync(process.argv[2], header + body);
console.log('written', years.length, 'years, sample 2024:', lines[2024-1900]);
console.log('2024 days:', years[2024-1900].join(','));
