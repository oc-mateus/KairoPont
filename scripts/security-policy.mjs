export function createSecurityPolicy(supabaseUrl) {
  const url = new URL(supabaseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid Supabase URL for security policy.');
  const origin = url.origin;
  const realtime = origin.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${origin}`,
    `connect-src 'self' ${origin} ${realtime}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self' blob:",
  ].join('; ');
}
