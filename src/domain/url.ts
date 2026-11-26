export function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

export function youtubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = hostOf(url);
    if (host === 'youtu.be') return parsed.pathname.replace(/\//g, '') || null;
    if (!host.endsWith('youtube.com')) return null;
    if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] ?? null;
    return parsed.searchParams.get('v');
  } catch {
    return null;
  }
}
