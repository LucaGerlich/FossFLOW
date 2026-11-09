/** React Router basename from PUBLIC_URL, without a trailing slash ('/' at the root). */
export function routerBasename(): string {
  const publicUrl = process.env.PUBLIC_URL || '';
  if (!publicUrl) return '/';
  return publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
}

/** Absolute URL of an app route, for links sent elsewhere (e.g. reset redirects). */
export function appUrl(path: string): string {
  const base = routerBasename() === '/' ? '' : routerBasename();
  return `${window.location.origin}${base}${path}`;
}
