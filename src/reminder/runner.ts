// 提醒执行服务：收集到期 → 逐条发送 → 无论成败都留痕
import { buildMessage, collectDueReminders, recordKey, type DueItem, type PlannedOccurrence } from './engine';
import type { ReminderStoreData, ReminderRecord } from './types';
import { saveStore, sentRecordKeys } from './storage';
import type { Sender } from './senders';

export interface RunResult {
  sent: DueItem[];
  failed: Array<{ item: DueItem; error: string }>;
  dryRun: DueItem[];
  records: ReminderRecord[];
  planned: PlannedOccurrence[];
}

interface RunOptions {
  today: Date;
  sender: Sender;
  dryRun?: boolean;
  persist?: boolean; // 默认 true；测试可关闭
}

export function runReminders(store: ReminderStoreData, opts: RunOptions): RunResult {
  const { today, sender, dryRun = false, persist = true } = opts;
  const { due, planned } = collectDueReminders(store.entries, today, sentRecordKeys(store.records));

  const result: RunResult = { sent: [], failed: [], dryRun: [], records: [], planned };

  for (const item of due) {
    const dateStr = recordDateStr(item);
    const key = recordKey(item.occurrence.entry.id, dateStr, item.lead);

    if (dryRun) {
      const record: ReminderRecord = {
        key, entryId: item.occurrence.entry.id, occurrenceDate: dateStr, lead: item.lead,
        status: 'dry-run', channel: sender.name, message: buildMessage(item),
        at: new Date().toISOString()
      };
      store.records.push(record);
      result.records.push(record);
      result.dryRun.push(item);
      continue;
    }

    let res;
    try {
      res = sender.send(item);
      if (res instanceof Promise) {
        // 发送器为异步时应由 runRemindersAsync 调用；这里保守标记失败，避免漏记
        throw new Error('异步发送器请使用 runRemindersAsync');
      }
    } catch (err) {
      res = { ok: false, channel: sender.name, message: buildMessage(item), error: err instanceof Error ? err.message : String(err) };
    }

    const record: ReminderRecord = {
      key, entryId: item.occurrence.entry.id, occurrenceDate: dateStr, lead: item.lead,
      status: res.ok ? 'sent' : 'failed', channel: res.channel, message: res.message,
      at: new Date().toISOString(), ...(res.error ? { error: res.error } : {})
    };
    store.records.push(record);
    result.records.push(record);
    if (res.ok) result.sent.push(item);
    else result.failed.push({ item, error: res.error ?? '未知错误' });
  }

  if (persist) saveStore(store);
  return result;
}

// 多数 Sender 是同步的；保留异步入口以便扩展（如 webhook）
export async function runRemindersAsync(store: ReminderStoreData, opts: RunOptions): Promise<RunResult> {
  const { today, sender, dryRun = false, persist = true } = opts;
  const { due, planned } = collectDueReminders(store.entries, today, sentRecordKeys(store.records));
  const result: RunResult = { sent: [], failed: [], dryRun: [], records: [], planned };

  for (const item of due) {
    const dateStr = recordDateStr(item);
    const key = recordKey(item.occurrence.entry.id, dateStr, item.lead);
    if (dryRun) {
      const record: ReminderRecord = {
        key, entryId: item.occurrence.entry.id, occurrenceDate: dateStr, lead: item.lead,
        status: 'dry-run', channel: sender.name, message: buildMessage(item),
        at: new Date().toISOString()
      };
      store.records.push(record);
      result.records.push(record);
      result.dryRun.push(item);
      continue;
    }
    let res;
    try {
      res = await sender.send(item);
    } catch (err) {
      res = { ok: false, channel: sender.name, message: buildMessage(item), error: err instanceof Error ? err.message : String(err) };
    }
    const record: ReminderRecord = {
      key, entryId: item.occurrence.entry.id, occurrenceDate: dateStr, lead: item.lead,
      status: res.ok ? 'sent' : 'failed', channel: res.channel, message: res.message,
      at: new Date().toISOString(), ...(res.error ? { error: res.error } : {})
    };
    store.records.push(record);
    result.records.push(record);
    if (res.ok) result.sent.push(item);
    else result.failed.push({ item, error: res.error ?? '未知错误' });
  }
  if (persist) saveStore(store);
  return result;
}

function recordDateStr(item: DueItem): string {
  const o = item.occurrence;
  return `${o.solarYear}-${String(o.solarMonth).padStart(2, '0')}-${String(o.solarDay).padStart(2, '0')}`;
}

