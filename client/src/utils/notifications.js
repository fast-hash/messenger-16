let audio;

export function initNotificationSound() {
  try {
    audio = new Audio('/sounds/message.mp3');
  } catch (e) {
    audio = null;
  }
}

export function playIncomingSound() {
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export async function showBrowserNotification({ title, body, tag }) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') {
    const ok = await ensureNotificationPermission();
    if (!ok) return;
  }
  // Короткое уведомление без навязчивых опций
  new Notification(title, { body, tag });
}
