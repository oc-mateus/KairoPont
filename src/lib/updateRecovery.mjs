// A tab opened before a deployment may request a chunk removed by that build.
// Reload once per entry bundle; persistent failures still reach the error UI.
export function recoverFromUpdate(event, { online, storage, location, buildId }) {
  if (!online) return false;
  try {
    const key = 'kairopont:update-recovery';
    if (storage.getItem(key) === buildId) return false;
    storage.setItem(key, buildId);
    event.preventDefault();
    location.reload();
    return true;
  } catch {
    return false;
  }
}
