import {
  DEFAULT_LEAD_DAYS,
  DeliveryRecord,
  DeliveryStatus,
  ReminderEntry,
  ReminderStore,
  deliveryKey,
  validateReminderInput,
} from '../almanac/reminders';

const STORAGE_KEY = 'lunar-family-reminders:v1';

export function createEmptyStore(): ReminderStore {
  return {
    entries: [],
    leadDays: DEFAULT_LEAD_DAYS,
    deliveries: {},
  };
}

export function loadReminderStore(storage: Storage = localStorage): ReminderStore {
  const fallback = createEmptyStore();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<ReminderStore>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.map(normalizeEntry).filter((item): item is ReminderEntry => item !== null)
      : [];
    const leadDays = normalizeLeadDays(parsed.leadDays);
    const deliveries = normalizeDeliveries(parsed.deliveries);

    return { entries, leadDays, deliveries };
  } catch {
    return fallback;
  }
}

export function saveReminderStore(store: ReminderStore, storage: Storage = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function addReminderEntry(store: ReminderStore, entry: ReminderEntry): ReminderStore {
  return saveAndReturn({
    ...store,
    entries: [...store.entries, entry],
  });
}

export function removeReminderEntry(store: ReminderStore, entryId: string): ReminderStore {
  return saveAndReturn({
    ...store,
    entries: store.entries.filter(entry => entry.id !== entryId),
  });
}

export function updateReminderPriority(store: ReminderStore, entryId: string, priority: number): ReminderStore {
  return saveAndReturn({
    ...store,
    entries: store.entries.map(entry =>
      entry.id === entryId ? { ...entry, priority } : entry,
    ),
  });
}

export function updateLeadDays(store: ReminderStore, leadDays: number): ReminderStore {
  return saveAndReturn({ ...store, leadDays: normalizeLeadDays(leadDays) });
}

export function markDelivery(
  store: ReminderStore,
  entryId: string,
  dateKey: string,
  status: DeliveryStatus,
  message?: string,
): ReminderStore {
  const record: DeliveryRecord = {
    status,
    at: new Date().toISOString(),
    ...(message ? { message } : {}),
  };
  return saveAndReturn({
    ...store,
    deliveries: {
      ...store.deliveries,
      [deliveryKey(entryId, dateKey)]: record,
    },
  });
}

export function removeDeliveryMark(store: ReminderStore, entryId: string, dateKey: string): ReminderStore {
  const deliveries = { ...store.deliveries };
  delete deliveries[deliveryKey(entryId, dateKey)];
  return saveAndReturn({ ...store, deliveries });
}

function saveAndReturn(store: ReminderStore): ReminderStore {
  saveReminderStore(store);
  return store;
}

function normalizeEntry(value: unknown): ReminderEntry | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<ReminderEntry>;
  const kind = item.kind === 'memorial' ? 'memorial' : item.kind === 'birthday' ? 'birthday' : null;
  if (!kind) return null;

  const month = Number(item.month);
  const day = Number(item.day);
  const leap = item.leap === 'leap' ? 'leap' : 'normal';
  const priority = Number.isInteger(item.priority) ? Number(item.priority) : kind === 'memorial' ? 10 : 20;
  const entry: ReminderEntry = {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    kind,
    month,
    day,
    leap,
    priority,
    createdAt: Number(item.createdAt) || 0,
  };

  if (!entry.id || validateReminderInput(entry) !== null) return null;
  return entry;
}

function normalizeLeadDays(value: unknown): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 30) return DEFAULT_LEAD_DAYS;
  return days;
}

function normalizeDeliveries(value: unknown): Record<string, DeliveryRecord> {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, DeliveryRecord> = {};

  for (const [key, raw] of Object.entries(source)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<DeliveryRecord>;
    if (item.status !== 'sent' && item.status !== 'failed' && item.status !== 'manual') continue;
    if (typeof item.at !== 'string') continue;
    result[key] = {
      status: item.status,
      at: item.at,
      ...(typeof item.message === 'string' ? { message: item.message } : {}),
    };
  }
  return result;
}
