import { ReminderOccurrence, ReminderStore, occurrenceBody, occurrenceTitle } from '../almanac/reminders';
import { markDelivery } from './reminder-store';

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export interface BrowserNotifier {
  permission: NotificationPermissionState;
  requestPermission: () => Promise<NotificationPermissionState>;
  notify: (title: string, body: string) => void;
}

export function createBrowserNotifier(): BrowserNotifier {
  if (typeof Notification === 'undefined') {
    return {
      permission: 'unsupported',
      requestPermission: async () => 'unsupported' as const,
      notify: () => {},
    };
  }

  return {
    permission: Notification.permission,
    requestPermission: async () => {
      const permission = await Notification.requestPermission();
      return permission;
    },
    notify: (title, body) => {
      new Notification(title, { body, tag: `lunar-reminder-${title}-${body.slice(0, 24)}` });
    },
  };
}

export function sendDueReminders(
  due: ReminderOccurrence[],
  store: ReminderStore,
  notifier: BrowserNotifier = createBrowserNotifier(),
): ReminderStore {
  let nextStore = store;

  for (const occurrence of due) {
    const record = nextStore.deliveries[occurrence.key];
    if (record && (record.status === 'sent' || record.status === 'manual')) continue;

    if (notifier.permission === 'granted' && record?.status === 'failed') {
      const deliveries = { ...nextStore.deliveries };
      delete deliveries[occurrence.key];
      nextStore = { ...nextStore, deliveries };
    }

    if (notifier.permission === 'unsupported') {
      nextStore = markDelivery(nextStore, occurrence.entry.id, occurrence.dateKey, 'failed', '当前浏览器不支持通知');
      continue;
    }

    if (notifier.permission !== 'granted') {
      nextStore = markDelivery(nextStore, occurrence.entry.id, occurrence.dateKey, 'failed', `通知权限为${notifier.permission}`);
      continue;
    }

    try {
      notifier.notify(occurrenceTitle(occurrence), occurrenceBody(occurrence));
      nextStore = markDelivery(nextStore, occurrence.entry.id, occurrence.dateKey, 'sent');
    } catch (error) {
      nextStore = markDelivery(
        nextStore,
        occurrence.entry.id,
        occurrence.dateKey,
        'failed',
        error instanceof Error ? error.message : '通知发送失败',
      );
    }
  }

  return nextStore;
}
