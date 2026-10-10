// Web-Push: Abo im Service Worker anlegen und am Server speichern.
import { api } from './api';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iOS erlaubt Push nur in der installierten Web-App (Home-Bildschirm). */
export function needsInstallForPush(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(): Promise<'enabled' | 'denied' | 'unsupported' | 'unconfigured'> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const key = await api.getPushKey();
  if (!key) return 'unconfigured';
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.savePushSubscription(json.endpoint, json.keys.p256dh, json.keys.auth);
  return 'enabled';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) {
    await api.deletePushSubscription(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  } else {
    await api.deletePushSubscription(null).catch(() => undefined);
  }
}
