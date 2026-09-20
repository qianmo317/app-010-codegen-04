// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderReminders } from './reminders';
import { emptyStore } from '../reminder/storage';
import { solarToLunar } from '../almanac/lunar';

const KEY = 'lunar-reminder:v1';

describe('生辰忌日页面（jsdom 冒烟）', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    history.pushState({}, '', '/reminders');
  });

  it('空数据时显示两个分区与空提示', () => {
    renderReminders(document.getElementById('app')!);
    const heads = [...document.querySelectorAll('.rm-section h3')].map(h => h.textContent);
    expect(heads.some(h => h!.includes('生日'))).toBe(true);
    expect(heads.some(h => h!.includes('祭日'))).toBe(true);
    expect(document.querySelectorAll('.rm-empty').length).toBeGreaterThanOrEqual(2);
  });

  it('填入示例后：生日/祭日分区各有记录，且显示剩余天数与当年公历日', () => {
    renderReminders(document.getElementById('app')!);
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent === '填入示例')!;
    btn.click();

    const birthdayItems = document.querySelectorAll('.rm-section')[0].querySelectorAll('.rm-item');
    const memorialItems = document.querySelectorAll('.rm-section')[1].querySelectorAll('.rm-item');
    expect(birthdayItems.length).toBe(2);
    expect(memorialItems.length).toBe(1);

    const text = document.getElementById('app')!.textContent!;
    // 示例含 2025 闰六月条目或当年的换算结果；必然出现「剩 N 天/今天」
    expect(text).toMatch(/剩\d+天|今天/);
    // 奶奶七月初一逢处暑的年份会标节气，且闰月样式至少在示例条目文本中出现「闰」
    expect(text).toContain('按闰月办');
    // 年预览卡片存在且列出 3 条
    expect(document.querySelector('.rm-preview')).toBeTruthy();
    expect(document.querySelectorAll('.rm-pv-row').length).toBeGreaterThanOrEqual(3);
  });

  it('演练后出现发送记录（留痕），且再次演练同批不重复', () => {
    // 先放一个今天附近的条目：直接写 store，令其今天命中提前 0 天
    const store = emptyStore();
    // 借助 occurrence 反推：添加一条任意记录后通过页面改不易；直接存数据
    const now = new Date();
    const l = solarToLunar(now.getFullYear(), now.getMonth() + 1, now.getDate());
    store.entries.push({
      id: 'm-today', kind: 'memorial', name: '今日先人',
      lunarMonth: l.month, lunarDay: l.day, leapMode: 'normal',
      leadDays: [0], createdAt: now.toISOString()
    });
    localStorage.setItem(KEY, JSON.stringify(store));

    renderReminders(document.getElementById('app')!);
    // 自动检查会在渲染时跑一次（in-app 发送，命中今天 → sent）
    const logText1 = document.querySelector('.rm-log')!.textContent!;
    expect(logText1).toContain('今日先人');

    const dryBtn = [...document.querySelectorAll('button')].find(b => b.textContent!.includes('演练'))!;
    dryBtn.click();
    const logsAfterDry = document.querySelectorAll('.rm-log-item');
    expect(logsAfterDry.length).toBe(1); // 今天那条已 sent，演练不再重复
  });

  it('删除按钮可移除条目', () => {
    renderReminders(document.getElementById('app')!);
    ([...document.querySelectorAll('button')].find(b => b.textContent === '填入示例')!).click();
    const firstDel = document.querySelector('.rm-del') as HTMLButtonElement;
    window.confirm = () => true;
    firstDel.click();
    const items = document.querySelectorAll('.rm-item');
    expect(items.length).toBe(2);
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.entries.length).toBe(2);
  });
});
