// Local notifications for the rest timer. There is no server to push from, so these are shown by
// the page itself (through the service worker when there is one): they arrive while the app is
// open or in the background, but not once the browser has suspended or closed it.
export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window
export const notifyPermission = () => (notifySupported() ? Notification.permission : 'unsupported')

export async function requestNotify() {
  if (!notifySupported()) return false
  if (Notification.permission === 'granted') return true
  return (await Notification.requestPermission()) === 'granted'
}

export async function showLocal(title, body, tag = 'ximnasioPardelo') {
  if (notifyPermission() !== 'granted') return false
  const opts = { body, tag, icon: 'icon-512.png', badge: 'icon-180.png', renotify: true }
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null
    if (reg) { await reg.showNotification(title, opts); return true }
    new Notification(title, opts)
    return true
  } catch { return false }
}
