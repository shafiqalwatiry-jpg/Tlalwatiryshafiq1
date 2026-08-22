/**
 * Tilawatak LilAlam - Native & Web Notification Utility
 * Integrates with Android WebAppInterface (`AndroidBridge`) and Web Notification API.
 */

// Cache of triggered notification keys to prevent duplicate system notifications in the same session
const triggeredNotificationKeys = new Set<string>();

export interface SystemNotificationOptions {
  id?: string;
  title: string;
  body: string;
  icon?: string;
  tag?: string;
}

/**
 * Dispatch a system-level notification.
 * 1. Checks if running in Android WebView with `AndroidBridge`
 * 2. Falls back to Web Notifications API if supported and permitted
 */
export function triggerSystemNotification(options: SystemNotificationOptions): boolean {
  const { id, title, body, icon = '/icon.png', tag } = options;

  // Deduplication key
  const dedupeKey = id || `${title}:${body}`;
  if (triggeredNotificationKeys.has(dedupeKey)) {
    return false;
  }
  triggeredNotificationKeys.add(dedupeKey);

  // 1. Android Native Bridge integration
  try {
    const win = window as any;
    if (win.AndroidBridge && typeof win.AndroidBridge.showNotification === 'function') {
      win.AndroidBridge.showNotification(title, body);
      return true;
    }
  } catch (err) {
    console.warn('[NotificationUtils] AndroidBridge call failed:', err);
  }

  // 2. Web Notification API (Browser / PWA)
  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon,
          tag: tag || id,
          dir: 'rtl',
          lang: 'ar'
        });
        return true;
      }
    }
  } catch (err) {
    console.warn('[NotificationUtils] Web Notification failed:', err);
  }

  return false;
}

/**
 * Request notification permissions on-demand (only when user interacts or enables notifications)
 */
export async function requestNotificationPermission(): Promise<boolean> {
  // If Android Bridge exists, permission is managed at the Android App level
  const win = window as any;
  if (win.AndroidBridge && typeof win.AndroidBridge.showNotification === 'function') {
    return true;
  }

  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch {
      return false;
    }
  }
  return false;
}
