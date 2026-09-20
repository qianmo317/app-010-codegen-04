// 本地存储：条目 + 提醒发送记录，全部存 localStorage，无服务端
import type { ReminderRecord, ReminderStoreData } from './types';
import { recordKey } from './engine';

const STORAGE_KEY = 'lunar-reminder:v1';

export function emptyStore(): ReminderStoreData {
  return { version: 1, entries: [], records: [] };
}

export function loadStore(): ReminderStoreData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const data = JSON.parse(raw) as ReminderStoreData;
    if (!data || data.version !== 1 || !Array.isArray(data.entries) || !Array.isArray(data.records)) {
      return emptyStore();
    }
    return data;
  } catch {
    return emptyStore();
  }
}

export function saveStore(data: ReminderStoreData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// 全部已留痕的记录键（含失败），用于日志展示
export function allRecordKeys(records: ReminderRecord[]): Set<string> {
  return new Set(records.map(r => recordKey(r.entryId, r.occurrenceDate, r.lead)));
}

// 已成功发出 / 演练过的记录键：用于本轮去重，避免同一天重复打扰；
// 失败（failed）的不在此列——下次运行仍会重试，但失败本身也保留在记录里。
export function sentRecordKeys(records: ReminderRecord[]): Set<string> {
  return new Set(
    records.filter(r => r.status === 'sent' || r.status === 'dry-run')
      .map(r => recordKey(r.entryId, r.occurrenceDate, r.lead))
  );
}

let seq = 0;
export function genId(kind: 'birthday' | 'memorial'): string {
  seq += 1;
  const p = kind === 'birthday' ? 'b' : 'm';
  return `${p}${Date.now().toString(36)}${seq.toString(36)}`;
}
