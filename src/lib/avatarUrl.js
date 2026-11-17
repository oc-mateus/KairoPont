// Stored profile fields are user-controlled. Never let them turn a managed
// avatar into a request to a tracking server when a colleague opens the page.
export function safeAvatarUrl(value, supabaseUrl) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const project = new URL(supabaseUrl);
    if (url.protocol !== 'https:' || url.origin !== project.origin || url.username || url.password || url.hash) return null;
    if (!/^\/storage\/v1\/object\/public\/fotos-funcionarios\/[0-9a-f-]{36}\/[a-z0-9_.-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)) return null;
    if ([...url.searchParams].some(([key, value]) => key !== 't' || !/^\d{1,20}$/.test(value))) return null;
    return url.href;
  } catch { return null; }
}

export function managedAvatarPath(value, supabaseUrl, employeeId) {
  const url = safeAvatarUrl(value, supabaseUrl);
  if (!url) return null;
  const path = new URL(url).pathname.split('/').slice(-2).join('/');
  return path.startsWith(`${employeeId}/`) ? path : null;
}
