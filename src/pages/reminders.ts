import { router } from '../router';
import { createElement, clearElement } from '../utils/dom';
import { LUNAR_MONTH_NAMES, LUNAR_DAY_NAMES, WEEK_DAYS } from '../almanac/constants';
import { getWeekDay } from '../utils/date';
import {
  planOccurrences, orderEntriesForSameDay, previewYear
} from '../reminder/engine';
import { occurrenceDateStr } from '../reminder/occurrence';
import { runReminders } from '../reminder/runner';
import { loadStore, saveStore, genId } from '../reminder/storage';
import { InAppSender, WebNotificationSender, requestNotificationPermission } from '../reminder/senders';
import type { ReminderEntry, ReminderStoreData, EntryKind, LeapMode } from '../reminder/types';

interface PageCtx {
  store: ReminderStoreData;
  app: HTMLElement;
}

let reminderTimer: number | undefined;
let toastHost: HTMLElement | null = null;
let notifyBound = false;

function ensureToastHost() {
  if (toastHost) return toastHost;
  toastHost = createElement('div', 'rm-toast-host');
  document.body.appendChild(toastHost);
  if (!notifyBound) {
    notifyBound = true;
    window.addEventListener('lunar-reminder:notify', ((e: Event) => {
      if (!toastHost) return;
      const detail = (e as CustomEvent).detail;
      const t = createElement('div', 'rm-toast');
      t.innerHTML = `<div class="rm-toast-title">${detail.title}</div><pre class="rm-toast-body">${detail.message}</pre>`;
      toastHost.appendChild(t);
      setTimeout(() => t.remove(), 8000);
    }) as EventListener);
  }
  return toastHost;
}

export function renderReminders(app: HTMLElement) {
  clearElement(app);
  app.className = 'page reminder-page';
  injectReminderStyles();
  window.clearInterval(reminderTimer);
  ensureToastHost();

  const store = loadStore();
  const ctx: PageCtx = { store, app };

  // 头部
  const header = createElement('div', 'page-header');
  const backBtn = createElement('button', 'back-btn', '◀ 返回');
  backBtn.addEventListener('click', () => router.navigate('/'));
  header.append(backBtn, createElement('h1', 'page-title', '生辰忌辰提醒'));

  // 操作条
  const toolbar = createElement('div', 'card rm-toolbar');
  const checkBtn = createElement('button', 'submit-btn rm-btn', '立即检查并发送到期提醒');
  const dryBtn = createElement('button', 'nav-btn rm-btn', '演练（只留痕不发送）');
  const permBtn = createElement('button', 'nav-btn rm-btn', '开启系统通知');
  const sampleBtn = createElement('button', 'nav-btn rm-btn', '填入示例');
  toolbar.append(
    p('到了提前日子自动提醒；过完的自动翻到下一年。数据只存在本机浏览器。'),
    btnRow([checkBtn, dryBtn, permBtn, sampleBtn])
  );

  const listHost = createElement('div', 'rm-list-anchor');
  const previewHost = createElement('div');
  const formHost = createElement('div');
  const logHost = createElement('div');

  function rerender() {
    renderLists(ctx, listHost, rerender);
    renderPreview(ctx, previewHost);
    renderLog(ctx, logHost);
  }

  checkBtn.addEventListener('click', () => {
    const r = runReminders(store, { today: new Date(), sender: new InAppSender() });
    rerender();
    flashResult(app, r.sent.length, r.failed.length, false);
  });
  dryBtn.addEventListener('click', () => {
    const r = runReminders(store, { today: new Date(), sender: new InAppSender(), dryRun: true });
    rerender();
    flashResult(app, 0, 0, true, r.dryRun.length);
  });
  permBtn.addEventListener('click', async () => {
    const p0 = await requestNotificationPermission();
    permBtn.textContent = p0 === 'granted' ? '系统通知已开启' : `系统通知：${p0}`;
    if (p0 === 'granted') {
      const r = runReminders(store, { today: new Date(), sender: new WebNotificationSender() });
      rerender();
      flashResult(app, r.sent.length, r.failed.length, false);
    }
  });
  sampleBtn.addEventListener('click', () => {
    seedSamples(store);
    rerender();
  });

  app.append(header, toolbar, listHost, previewHost, formHost, logHost);
  renderForm(ctx, formHost, rerender);

  // 打开页面先检查一次，再做首屏渲染（使发送记录立即可见）；之后每小时检查
  const checkOnce = () => runReminders(store, { today: new Date(), sender: new InAppSender() });
  checkOnce();
  rerender();
  reminderTimer = window.setInterval(() => {
    checkOnce();
    rerender();
  }, 60 * 60 * 1000);
  window.addEventListener('pagehide', () => window.clearInterval(reminderTimer), { once: true });
}

function p(text: string): HTMLElement {
  return createElement('p', 'rm-hint', text);
}
function btnRow(btns: HTMLElement[]): HTMLElement {
  const row = createElement('div', 'rm-btn-row');
  row.append(...btns);
  return row;
}

function renderLists(ctx: PageCtx, host: HTMLElement, onChanged: () => void) {
  clearElement(host);
  const today = new Date();
  const planned = planOccurrences(ctx.store.entries, today);

  // 同日分组，用于撞期提示
  const byDate = new Map<string, typeof planned>();
  for (const item of planned) {
    const key = occurrenceDateStr(item.occurrence);
    const arr = byDate.get(key) ?? [];
    arr.push(item);
    byDate.set(key, arr);
  }

  const sections: Array<{ kind: EntryKind; title: string; icon: string }> = [
    { kind: 'birthday', title: '生日', icon: '🎂' },
    { kind: 'memorial', title: '祭日', icon: '🕯️' }
  ];

  for (const sec of sections) {
    const card = createElement('div', 'card rm-section');
    card.innerHTML = `<h3>${sec.icon} ${sec.title}</h3>`;
    const items = planned
      .filter(x => x.occurrence.entry.kind === sec.kind)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    if (items.length === 0) {
      card.appendChild(createElement('div', 'rm-empty', '还没有记录，用下方表单添加。'));
    }

    for (const item of items) {
      const o = item.occurrence;
      const e = o.entry;
      const row = createElement('div', `rm-item ${item.daysLeft <= 7 ? 'soon' : ''}`);
      const week = WEEK_DAYS[getWeekDay(o.solarYear, o.solarMonth, o.solarDay)];
      const sameDay = byDate.get(occurrenceDateStr(o))!;
      const ordered = orderEntriesForSameDay(sameDay.map(x => x.occurrence.entry));
      const order = ordered.findIndex(x => x.id === e.id) + 1;
      const leads = e.leadDays.slice().sort((a, b) => a - b).map(l => l === 0 ? '当天' : `提前${l}天`).join('、');

      row.innerHTML = `
        <div class="rm-item-main">
          <div class="rm-item-name">${escapeHtml(e.name)}</div>
          <div class="rm-item-lunar">农历${o.isLeap ? '<em class="rm-leap">闰</em>' : ''}${LUNAR_MONTH_NAMES[e.lunarMonth - 1]}月${LUNAR_DAY_NAMES[o.dayClamped ? 28 : e.lunarDay - 1]}</div>
          <div class="rm-item-solar">公历 ${occurrenceDateStr(o)} 周${week}</div>
          ${o.leapNote ? `<div class="rm-note">${escapeHtml(o.leapNote)}</div>` : ''}
          ${item.solarTerm ? `<div class="rm-term">当天恰逢节气「${item.solarTerm}」</div>` : ''}
          ${sameDay.length > 1 ? `<div class="rm-collide">同日还有 ${sameDay.length - 1} 件事，本件排第 ${order}/${sameDay.length}（祭日优先、生日在后）</div>` : ''}
          <div class="rm-leads">提醒：${leads}</div>
          ${e.note ? `<div class="rm-note">备注：${escapeHtml(e.note)}</div>` : ''}
        </div>
        <div class="rm-item-side">
          <div class="rm-days ${item.daysLeft === 0 ? 'today' : ''}">${item.daysLeft === 0 ? '今天' : `剩${item.daysLeft}天`}</div>
          <button class="rm-del" data-id="${e.id}">删除</button>
        </div>`;
      row.querySelector('.rm-del')!.addEventListener('click', () => {
        if (confirm(`删除「${e.name}」的${sec.title}记录？`)) {
          ctx.store.entries = ctx.store.entries.filter(x => x.id !== e.id);
          saveStore(ctx.store);
          onChanged();
        }
      });
      card.appendChild(row);
    }
    host.appendChild(card);
  }
}

function renderForm(ctx: PageCtx, host: HTMLElement, onChanged: () => void) {
  const card = createElement('div', 'card rm-section');
  card.innerHTML = '<h3>➕ 添加一条（只填农历月、日）</h3>';

  const form = document.createElement('div');
  form.className = 'rm-form';
  form.innerHTML = `
    <label class="rm-f-name">称呼
      <input type="text" class="f-name" maxlength="20" placeholder="如：奶奶 / 先祖父" required>
    </label>
    <label>类型
      <span class="rm-radio">
        <label><input type="radio" name="kind" value="birthday" checked> 生日</label>
        <label><input type="radio" name="kind" value="memorial"> 祭日</label>
      </span>
    </label>
    <label>农历月
      <select class="f-month">${LUNAR_MONTH_NAMES.map((m, i) => `<option value="${i + 1}">${m}月</option>`).join('')}</select>
    </label>
    <label>农历日
      <select class="f-day">${LUNAR_DAY_NAMES.map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}</select>
    </label>
    <label>闰月怎么办
      <span class="rm-radio">
        <label><input type="radio" name="leap" value="normal" checked> 按平常月</label>
        <label><input type="radio" name="leap" value="leap"> 按闰月</label>
      </span>
      <small class="rm-hint">轮上闰月的年份会在提醒里说明；两种都想办就各记一条。</small>
    </label>
    <label>提前提醒
      <span class="rm-checks">
        <label><input type="checkbox" value="0" checked> 当天</label>
        <label><input type="checkbox" value="1"> 1天</label>
        <label><input type="checkbox" value="3" checked> 3天</label>
        <label><input type="checkbox" value="7" checked> 7天</label>
        <label><input type="checkbox" value="15"> 15天</label>
      </span>
    </label>
    <label class="rm-f-prio">同日排序权重
      <input type="number" class="f-prio" min="0" max="999" placeholder="小者在前（可不填）">
    </label>
    <label class="rm-f-note">备注
      <input type="text" class="f-note" maxlength="60" placeholder="可选">
    </label>`;

  const addBtn = createElement('button', 'submit-btn', '添加');
  const errLine = createElement('div', 'rm-form-err');

  addBtn.addEventListener('click', () => {
    const name = (form.querySelector('.f-name') as HTMLInputElement).value.trim();
    errLine.textContent = '';
    if (!name) { errLine.textContent = '请填写称呼。'; return; }
    const kind = (form.querySelector('input[name="kind"]:checked') as HTMLInputElement).value as EntryKind;
    const lunarMonth = Number((form.querySelector('.f-month') as HTMLSelectElement).value);
    const lunarDay = Number((form.querySelector('.f-day') as HTMLSelectElement).value);
    const leapMode = (form.querySelector('input[name="leap"]:checked') as HTMLInputElement).value as LeapMode;
    const leadDays = [...form.querySelectorAll<HTMLInputElement>('.rm-checks input:checked')].map(i => Number(i.value));
    if (leadDays.length === 0) { errLine.textContent = '至少选一个提前提醒日。'; return; }
    const prioRaw = (form.querySelector('.f-prio') as HTMLInputElement).value;
    const note = (form.querySelector('.f-note') as HTMLInputElement).value.trim();

    const entry: ReminderEntry = {
      id: genId(kind), kind, name, lunarMonth, lunarDay, leapMode,
      leadDays: leadDays.sort((a, b) => a - b),
      createdAt: new Date().toISOString(),
      ...(prioRaw ? { priority: Number(prioRaw) } : {}),
      ...(note ? { note } : {})
    };
    ctx.store.entries.push(entry);
    saveStore(ctx.store);
    (form.querySelector('.f-name') as HTMLInputElement).value = '';
    (form.querySelector('.f-note') as HTMLInputElement).value = '';
    onChanged();
  });

  card.append(form, addBtn, errLine);
  host.appendChild(card);
}

let previewYearState = new Date().getFullYear();

function renderPreview(ctx: PageCtx, host: HTMLElement) {
  clearElement(host);
  const year = Math.min(2100, Math.max(1901, previewYearState));
  const card = createElement('div', 'card rm-section rm-preview');
  const head = createElement('div', 'rm-preview-head');
  head.innerHTML = `<h3>🗓️ ${year} 公历年内全部日子</h3>`;
  const nav = createElement('div', 'rm-preview-nav');
  const prev = createElement('button', 'nav-btn rm-btn', '◀');
  const label = createElement('span', 'rm-preview-year', `${year} 年`);
  const next = createElement('button', 'nav-btn rm-btn', '▶');
  prev.addEventListener('click', () => { previewYearState = year - 1; renderPreview(ctx, host); });
  next.addEventListener('click', () => { previewYearState = year + 1; renderPreview(ctx, host); });
  nav.append(prev, label, next);
  head.appendChild(nav);
  card.appendChild(head);

  const rows = previewYear(ctx.store.entries, year);
  rows.sort((a, b) =>
    `${a.occurrence.solarMonth}-${a.occurrence.solarDay}`.localeCompare(`${b.occurrence.solarMonth}-${b.occurrence.solarDay}`) ||
    a.occurrence.entry.kind.localeCompare(b.occurrence.entry.kind));

  if (rows.length === 0) {
    card.appendChild(createElement('div', 'rm-empty', '本年没有任何记录。'));
  } else {
    const list = createElement('div', 'rm-preview-list');
    for (const r of rows) {
      const o = r.occurrence;
      const e = r.entry;
      const week = WEEK_DAYS[getWeekDay(o.solarYear, o.solarMonth, o.solarDay)];
      const row = createElement('div', `rm-pv-row ${e.kind}`);
      row.innerHTML = `
        <span class="rm-pv-date">${o.solarMonth}月${o.solarDay}日 周${week}</span>
        <span class="rm-pv-kind ${e.kind}">${e.kind === 'birthday' ? '🎂生' : '🕯️祭'}</span>
        <span class="rm-pv-name">${escapeHtml(e.name)}</span>
        <span class="rm-pv-lunar">${o.isLeap ? '<em class="rm-leap">闰</em>' : ''}${LUNAR_MONTH_NAMES[e.lunarMonth - 1]}月${LUNAR_DAY_NAMES[o.dayClamped ? 28 : e.lunarDay - 1]}</span>
        ${r.solarTerm ? `<span class="rm-term">${r.solarTerm}</span>` : ''}
        ${o.leapNote ? `<span class="rm-note">${escapeHtml(o.leapNote)}</span>` : ''}`;
      list.appendChild(row);
    }
    card.appendChild(list);
    card.appendChild(createElement('div', 'rm-hint', '注：腊月类日子可能在公历年初、年末各出现一次（分属相邻农历年）；过完的下一轮以「剩余天数」列表为准。'));
  }
  host.appendChild(card);
}

function renderLog(ctx: PageCtx, host: HTMLElement) {
  clearElement(host);
  const card = createElement('div', 'card rm-section rm-log');
  card.innerHTML = '<h3>📜 提醒发送记录（发没发出去都留记号）</h3>';
  const records = ctx.store.records.slice().reverse().slice(0, 30);
  if (records.length === 0) {
    card.appendChild(createElement('div', 'rm-empty', '暂无记录。'));
  } else {
    const ul = createElement('div', 'rm-log-list');
    for (const r of records) {
      const icon = r.status === 'sent' ? '✅' : r.status === 'failed' ? '❌' : '🧪';
      const item = createElement('div', `rm-log-item ${r.status}`);
      item.innerHTML = `
        <span class="rm-log-icon">${icon}</span>
        <span class="rm-log-date">${r.occurrenceDate}（提前${r.lead}天）</span>
        <span class="rm-log-channel">${r.channel}</span>
        <span class="rm-log-time">${new Date(r.at).toLocaleString('zh-CN')}</span>
        ${r.error ? `<div class="rm-log-err">失败原因：${escapeHtml(r.error)}</div>` : ''}
        <pre class="rm-log-msg">${escapeHtml(r.message)}</pre>`;
      ul.appendChild(item);
    }
    card.appendChild(ul);
  }
  host.appendChild(card);
}

function flashResult(app: HTMLElement, sent: number, failed: number, dryRun: boolean, dryCount = 0) {
  const text = dryRun
    ? `演练完成，生成 ${dryCount} 条留痕（未真正发送）。`
    : `检查完成：成功 ${sent} 条${failed ? `，失败 ${failed} 条（已留痕，下次自动重试）` : ''}。`;
  const old = app.querySelector('.rm-flash');
  if (old) old.remove();
  const bar = createElement('div', `rm-flash ${failed ? 'has-fail' : ''}`, text);
  app.querySelector('.rm-toolbar')!.after(bar);
  setTimeout(() => bar.remove(), 5000);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function seedSamples(store: ReminderStoreData) {
  if (store.entries.some(e => e.id === 'sample-b1')) return;
  const now = new Date().toISOString();
  const samples: ReminderEntry[] = [
    { id: 'sample-b1', kind: 'birthday', name: '奶奶', lunarMonth: 7, lunarDay: 1, leapMode: 'normal', leadDays: [7, 3, 0], createdAt: now, note: '示例' },
    { id: 'sample-b2', kind: 'birthday', name: '小侄子', lunarMonth: 6, lunarDay: 1, leapMode: 'leap', leadDays: [15, 3, 0], createdAt: now, note: '示例：按闰月办' },
    { id: 'sample-m1', kind: 'memorial', name: '先祖父', lunarMonth: 8, lunarDay: 15, leapMode: 'normal', leadDays: [7, 1, 0], createdAt: now, note: '示例' }
  ];
  store.entries.push(...samples);
  saveStore(store);
}

let stylesInjected = false;
function injectReminderStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .rm-hint { color: var(--text-light); font-size: 13px; margin-bottom: 10px; }
    .rm-btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .rm-btn { padding: 8px 14px; font-size: 13px; }
    .rm-toolbar .submit-btn { width: auto; padding: 8px 16px; }
    .rm-section { margin-top: 16px; }
    .rm-item {
      display: flex; justify-content: space-between; gap: 12px; align-items: flex-start;
      padding: 12px 0; border-bottom: 1px dashed var(--border);
    }
    .rm-item:last-child { border-bottom: none; }
    .rm-item.soon { background: #fff8ec; margin: 4px -8px; padding: 12px 8px; border-radius: 8px; }
    .rm-item-name { font-size: 17px; font-weight: bold; color: var(--primary); }
    .rm-item-lunar { font-size: 15px; margin-top: 2px; }
    .rm-item-solar { font-size: 13px; color: var(--text-light); margin-top: 2px; }
    .rm-leap { color: var(--accent); font-style: normal; font-weight: bold; }
    .rm-note { font-size: 12px; color: #8a6d3b; margin-top: 4px; }
    .rm-term { font-size: 12px; color: var(--secondary); margin-top: 4px; font-weight: bold; }
    .rm-collide { font-size: 12px; color: var(--accent); margin-top: 4px; }
    .rm-leads { font-size: 12px; color: var(--text-light); margin-top: 4px; }
    .rm-item-side { text-align: center; min-width: 72px; }
    .rm-days { font-size: 18px; font-weight: bold; color: var(--primary-light); white-space: nowrap; }
    .rm-days.today { color: var(--accent); font-size: 20px; }
    .rm-del {
      margin-top: 6px; padding: 2px 10px; font-size: 12px;
      border: 1px solid var(--border); background: transparent; border-radius: 4px;
      color: var(--text-light); cursor: pointer;
    }
    .rm-del:hover { color: var(--accent); border-color: var(--accent); }
    .rm-empty { color: var(--text-light); font-size: 13px; padding: 8px 0; }
    .rm-form { display: grid; gap: 12px; grid-template-columns: repeat(2, 1fr); }
    .rm-form label { font-size: 13px; color: var(--primary); display: flex; flex-direction: column; gap: 4px; }
    .rm-form input[type="text"], .rm-form input[type="number"], .rm-form select {
      padding: 8px 10px; border: 1px solid var(--border); border-radius: 4px; font-size: 14px;
    }
    .rm-radio, .rm-checks { display: flex; gap: 14px; flex-wrap: wrap; color: var(--text); font-weight: normal; }
    .rm-f-name { grid-column: 1 / 3; }
    .rm-f-note { grid-column: 1 / 3; }
    .rm-form > .submit-btn { grid-column: 1 / 3; }
    .rm-form-err { color: var(--accent); font-size: 13px; margin-top: 8px; }

    .rm-preview-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .rm-preview-head h3 { margin-bottom: 0; }
    .rm-preview-nav { display: flex; align-items: center; gap: 8px; }
    .rm-preview-year { font-weight: bold; color: var(--primary); min-width: 56px; text-align: center; }
    .rm-preview-list { display: grid; gap: 6px; }
    .rm-pv-row {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 8px 10px; border-radius: 6px; background: var(--bg); font-size: 13px;
    }
    .rm-pv-row.memorial { border-left: 3px solid var(--text-light); }
    .rm-pv-row.birthday { border-left: 3px solid var(--accent); }
    .rm-pv-date { font-weight: bold; min-width: 120px; }
    .rm-pv-kind { font-size: 12px; }
    .rm-pv-name { color: var(--primary); font-weight: bold; }
    .rm-pv-lunar { color: var(--text-light); }
    .rm-log-list { display: grid; gap: 8px; }
    .rm-log-item {
      border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; font-size: 12px;
      display: grid; grid-template-columns: auto 1fr auto auto; gap: 4px 10px; align-items: center;
      background: var(--bg);
    }
    .rm-log-item.failed { border-color: var(--accent); background: #fff5f5; }
    .rm-log-item.dry-run { opacity: .8; }
    .rm-log-msg { grid-column: 1 / 5; white-space: pre-wrap; color: var(--text-light); margin-top: 2px; }
    .rm-log-err { grid-column: 1 / 5; color: var(--accent); }
    .rm-flash {
      margin: 12px 0; padding: 10px 16px; border-radius: 8px;
      background: var(--secondary); color: #fff; font-size: 14px;
    }
    .rm-flash.has-fail { background: var(--accent); }
    .rm-toast-host { position: fixed; right: 12px; bottom: 12px; z-index: 99; display: grid; gap: 8px; max-width: 340px; }
    .rm-toast {
      background: #fff; border-left: 4px solid var(--accent); border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,.18); padding: 10px 14px; font-size: 13px;
      animation: rm-slide .25s ease;
    }
    .rm-toast-title { font-weight: bold; color: var(--primary); margin-bottom: 4px; }
    .rm-toast-body { white-space: pre-wrap; font-family: inherit; margin: 0; }
    @keyframes rm-slide { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (max-width: 600px) {
      .rm-form { grid-template-columns: 1fr; }
      .rm-f-name, .rm-f-note, .rm-form > .submit-btn { grid-column: auto; }
    }
  `;
  document.head.appendChild(style);
}
