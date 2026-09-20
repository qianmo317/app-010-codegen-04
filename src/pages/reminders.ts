import { router } from '../router';
import { createElement, clearElement } from '../utils/dom';
import {
  DeliveryRecord,
  ReminderEntry,
  ReminderKind,
  ReminderOccurrence,
  createReminderEntry,
  defaultPriority,
  formatDaysRemaining,
  getDueOccurrences,
  getReminderOccurrences,
  groupCollisions,
  occurrenceBody,
  occurrenceTitle,
  validateReminderInput,
} from '../almanac/reminders';
import {
  addReminderEntry,
  loadReminderStore,
  markDelivery,
  removeDeliveryMark,
  removeReminderEntry,
  updateLeadDays,
  updateReminderPriority,
} from '../utils/reminder-store';
import {
  BrowserNotifier,
  createBrowserNotifier,
  sendDueReminders,
} from '../utils/notifications';

export function renderReminders(app: HTMLElement) {
  clearElement(app);
  app.className = 'page reminders-page';

  let store = loadReminderStore();
  let notifier = createBrowserNotifier();
  const due = getDueOccurrences(getReminderOccurrences(store.entries), store.leadDays);
  store = sendDueReminders(due, store, notifier);

  const header = createElement('div', 'page-header');
  const backBtn = createElement('button', 'back-btn', '◀ 返回');
  backBtn.addEventListener('click', () => router.navigate('/'));
  const title = createElement('h1', 'page-title', '家祭与生日提醒');
  header.append(backBtn, title);

  const listArea = createElement('div', 'reminder-sections');

  function rerender() {
    store = loadReminderStore();
    notifier = createBrowserNotifier();
    renderLists(listArea, store, rerender);
    permissionBtn.textContent = permissionText(notifier.permission);
  }

  const formCard = createElement('div', 'card reminder-form-card');
  formCard.appendChild(createElement('h3', undefined, '新增一条农历日子'));

  const kindSelect = createSelect('reminder-kind', [
    { value: 'birthday', label: '家里人生日' },
    { value: 'memorial', label: '老人祭日' },
  ]) as HTMLSelectElement;
  const nameInput = createInput('text', '称呼，如：父亲、祖母');
  const monthInput = createNumberInput('1-12', 1, 12);
  const dayInput = createNumberInput('1-30', 1, 30);
  const leapSelect = createSelect('reminder-leap', [
    { value: 'normal', label: '按平常那个月' },
    { value: 'leap', label: '按闰月' },
  ]) as HTMLSelectElement;
  const priorityInput = createNumberInput('1-999', 1, 999, defaultPriority('birthday'));

  kindSelect.addEventListener('change', () => {
    priorityInput.value = String(defaultPriority(kindSelect.value as ReminderKind));
  });

  appendField(formCard, '类别', kindSelect);
  appendField(formCard, '称呼', nameInput);
  appendField(formCard, '农历月', monthInput);
  appendField(formCard, '农历日（1=初一，15=十五，30=三十）', dayInput);
  appendField(formCard, '遇闰月怎么办', leapSelect);
  appendField(formCard, '同日先后（数字小的先办）', priorityInput);

  const hint = createElement(
    'p',
    'reminder-hint',
    '平常月和闰月两种都想记时，用同样的月日分别新增一条即可；农历三十遇到小月会自动落在当月最后一天并标明。',
  );
  formCard.appendChild(hint);

  const errorText = createElement('p', 'reminder-error');
  const submitBtn = createElement('button', 'submit-btn', '记下这条');
  submitBtn.addEventListener('click', () => {
    const kind = kindSelect.value as ReminderKind;
    const input = {
      name: nameInput.value,
      kind,
      month: Number(monthInput.value),
      day: Number(dayInput.value),
      leap: leapSelect.value as ReminderEntry['leap'],
      priority: Number(priorityInput.value),
    };
    const error = validateReminderInput(input);
    if (error) {
      errorText.textContent = error;
      return;
    }

    store = addReminderEntry(store, createReminderEntry(input));
    rerender();
    nameInput.value = '';
    monthInput.value = '';
    dayInput.value = '';
    leapSelect.value = 'normal';
    priorityInput.value = String(defaultPriority(kind));
    errorText.textContent = '';
  });
  formCard.append(errorText, submitBtn);

  const settingsCard = createElement('div', 'card reminder-settings');
  settingsCard.appendChild(createElement('h3', undefined, '提前提醒'));
  const leadInput = createNumberInput('0-30', 0, 30, store.leadDays);
  leadInput.addEventListener('change', () => {
    const days = Number(leadInput.value);
    store = updateLeadDays(store, Number.isInteger(days) ? days : 7);
    store = sendDueReminders(getDueOccurrences(getReminderOccurrences(store.entries), store.leadDays), store, notifier);
    rerender();
  });
  appendField(settingsCard, '提前天数（0 表示当天才提醒）', leadInput);

  const permissionBtn = createElement('button', 'nav-btn permission-btn', permissionText(notifier.permission));
  permissionBtn.addEventListener('click', async () => {
    const permission = await notifier.requestPermission();
    notifier = { ...notifier, permission };
    permissionBtn.textContent = permissionText(permission);
    if (permission === 'granted') {
      store = sendDueReminders(getDueOccurrences(getReminderOccurrences(store.entries), store.leadDays), store, notifier);
      rerender();
    }
  });
  const permissionRow = createElement('div', 'permission-row');
  permissionRow.append(
    createElement('span', undefined, '浏览器通知权限：打开本页时会在设定天数内自动检查并发通知，发送结果会留痕。'),
    permissionBtn,
  );
  settingsCard.appendChild(permissionRow);

  app.append(header, settingsCard, listArea, formCard);
  renderLists(listArea, store, rerender);
}

function renderLists(container: HTMLElement, store: ReturnType<typeof loadReminderStore>, rerender: () => void) {
  clearElement(container);

  const occurrences = getReminderOccurrences(store.entries);
  const collisions = groupCollisions(occurrences);
  const sections: Array<{ kind: ReminderKind; title: string }> = [
    { kind: 'birthday', title: '家里人农历生日' },
    { kind: 'memorial', title: '老人祭日' },
  ];

  sections.forEach(section => {
    const card = createElement('section', 'card reminder-list-card');
    card.appendChild(createElement('h3', undefined, section.title));

    const list = createElement('div', 'reminder-list');
    const items = occurrences.filter(item => item.entry.kind === section.kind);
    if (items.length === 0) {
      list.appendChild(createElement('p', 'empty-reminders', '还没有记录，在下面新增一条。'));
    } else {
      items.forEach(item => list.appendChild(renderOccurrence(item, collisions, store, rerender)));
    }
    card.appendChild(list);
    container.appendChild(card);
  });
}

function renderOccurrence(
  item: ReminderOccurrence,
  collisions: Map<string, ReminderOccurrence[]>,
  store: ReturnType<typeof loadReminderStore>,
  rerender: () => void,
): HTMLElement {
  const row = createElement('article', 'reminder-item');
  const sameDay = collisions.get(item.dateKey) ?? [item];

  const head = createElement('div', 'reminder-item-head');
  const name = createElement('div', 'reminder-name', item.entry.name);
  const days = createElement('div', `reminder-days urgency-${urgencyClass(item.daysRemaining)}`, formatDaysRemaining(item.daysRemaining));
  head.append(name, days);

  const lines = createElement('div', 'reminder-lines');
  addLine(lines, '公历', item.dateKey);
  addLine(lines, '农历', item.lunarLabel);
  addLine(lines, '闰月', item.leapLabel);
  if (item.adjustedDay) {
    addLine(lines, '小月调整', '今年该月没有三十，按本月最后一天（廿九）办');
  }
  if (item.entry.day === 1 || item.entry.day === 15) {
    addLine(lines, '节气', item.solarTerm ? `恰逢${item.solarTerm}` : '未逢节气');
  }
  addLine(
    lines,
    '同日先后',
    sameDay.length > 1
      ? `这天共有 ${sameDay.length} 件事，本条排第 ${sameDay.indexOf(item) + 1} 件`
      : '这天只有这一件事',
  );

  const delivery = store.deliveries[item.key];
  if (delivery) {
    addLine(lines, '提醒记号', deliveryText(delivery));
  } else if (item.daysRemaining <= store.leadDays) {
    addLine(lines, '提醒记号', '已到提醒期，但还没有发送记录');
  } else {
    addLine(lines, '提醒记号', `未到提醒期（提前 ${store.leadDays} 天）`);
  }

  const actions = createElement('div', 'reminder-actions');
  const upBtn = createElement('button', 'small-btn', '提前');
  const downBtn = createElement('button', 'small-btn', '靠后');
  const priorityLabel = createElement('span', 'priority-label', `次序 ${item.entry.priority}`);
  upBtn.addEventListener('click', () => {
    updateReminderPriority(store, item.entry.id, Math.max(1, item.entry.priority - 10));
    rerender();
  });
  downBtn.addEventListener('click', () => {
    updateReminderPriority(store, item.entry.id, Math.min(999, item.entry.priority + 10));
    rerender();
  });

  const markBtn = createElement('button', 'small-btn', delivery ? '重留已通知记号' : '标记已通知');
  markBtn.addEventListener('click', () => {
    markDelivery(store, item.entry.id, item.dateKey, 'manual');
    rerender();
  });

  const testBtn = createElement('button', 'small-btn', '看提醒文案');
  testBtn.addEventListener('click', () => {
    alert(`${occurrenceTitle(item)}\n\n${occurrenceBody(item)}`);
  });

  let clearMarkBtn: HTMLElement | undefined;
  if (delivery) {
    clearMarkBtn = createElement('button', 'small-btn', '清除记号');
    clearMarkBtn.addEventListener('click', () => {
      removeDeliveryMark(store, item.entry.id, item.dateKey);
      rerender();
    });
  }

  const deleteBtn = createElement('button', 'small-btn danger-btn', '删除');
  deleteBtn.addEventListener('click', () => {
    if (confirm(`删除「${item.entry.name}」的这条记录？`)) {
      removeReminderEntry(store, item.entry.id);
      rerender();
    }
  });

  actions.append(upBtn, priorityLabel, downBtn, markBtn, testBtn, deleteBtn);
  if (clearMarkBtn) actions.appendChild(clearMarkBtn);
  row.append(head, lines, actions);
  return row;
}

function urgencyClass(days: number): string {
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  if (days <= 7) return 'near';
  return 'later';
}

function deliveryText(record: DeliveryRecord): string {
  const time = new Date(record.at).toLocaleString('zh-CN', { hour12: false });
  const status = record.status === 'sent'
    ? '已发出'
    : record.status === 'manual'
      ? '已手动留痕'
      : `未发出（${record.message ?? '原因未记录'}）`;
  return `${status} · ${time}`;
}

function permissionText(permission: BrowserNotifier['permission']): string {
  if (permission === 'granted') return '通知权限已开启';
  if (permission === 'denied') return '通知权限被拒绝';
  if (permission === 'unsupported') return '浏览器不支持通知';
  return '开启通知权限';
}

function appendField(parent: HTMLElement, label: string, input: HTMLElement) {
  const field = createElement('label', 'reminder-field');
  field.appendChild(createElement('span', undefined, label));
  field.appendChild(input);
  parent.appendChild(field);
}

function addLine(parent: HTMLElement, label: string, value: string) {
  const line = createElement('div', 'reminder-line');
  const labelEl = createElement('span', 'reminder-line-label', label);
  const valueEl = createElement('span', 'reminder-line-value', value);
  line.append(labelEl, valueEl);
  parent.appendChild(line);
}

function createInput(type: string, placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  return input;
}

function createNumberInput(placeholder: string, min: number, max: number, value?: number): HTMLInputElement {
  const input = createInput('number', placeholder);
  input.min = String(min);
  input.max = String(max);
  if (value !== undefined) input.value = String(value);
  return input;
}

function createSelect(id: string, options: Array<{ value: string; label: string }>): HTMLSelectElement {
  const select = document.createElement('select');
  select.id = id;
  options.forEach(option => {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    select.appendChild(el);
  });
  return select;
}
