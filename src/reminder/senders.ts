// 提醒发送器：统一接口，成功/失败都返回结果交由上层留痕
import type { DueItem } from './engine';
import { buildMessage } from './engine';

export interface SendResult {
  ok: boolean;
  channel: string;
  message: string;
  error?: string;
}

export interface Sender {
  name: string;
  send(item: DueItem): Promise<SendResult> | SendResult;
}

// 应用内发送器：把提醒抛到页面顶部通知区（由 UI 监听 custom event 渲染）
export class InAppSender implements Sender {
  name = 'in-app';
  send(item: DueItem): SendResult {
    const message = buildMessage(item);
    window.dispatchEvent(new CustomEvent('lunar-reminder:notify', {
      detail: {
        entryId: item.occurrence.entry.id,
        title: item.occurrence.entry.kind === 'birthday' ? '🎂 生日提醒' : '🕯️ 祭日提醒',
        message
      }
    }));
    return { ok: true, channel: this.name, message };
  }
}

// 浏览器系统通知（需用户授权；未授权/不支持时返回 failed 并留痕，不静默丢弃）
export class WebNotificationSender implements Sender {
  name = 'web-notification';
  send(item: DueItem): SendResult {
    const message = buildMessage(item);
    if (typeof Notification === 'undefined') {
      return { ok: false, channel: this.name, message, error: '当前浏览器不支持系统通知' };
    }
    if (Notification.permission === 'denied') {
      return { ok: false, channel: this.name, message, error: '系统通知权限被拒绝' };
    }
    if (Notification.permission !== 'granted') {
      return { ok: false, channel: this.name, message, error: '系统通知尚未授权' };
    }
    try {
      const n = new Notification(
        item.occurrence.entry.kind === 'birthday' ? '🎂 农历生日提醒' : '🕯️ 农历祭日提醒',
        { body: message }
      );
      n.onshow = () => { /* 已展示 */ };
      return { ok: true, channel: this.name, message };
    } catch (err) {
      return { ok: false, channel: this.name, message, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
  return Notification.requestPermission();
}
