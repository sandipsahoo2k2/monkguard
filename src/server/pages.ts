import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

const cache = new Map<string, string>();

function page(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;
  try {
    const html = readFileSync(join(WEB_DIR, name), 'utf8');
    cache.set(name, html);
    return html;
  } catch {
    return `<!doctype html><meta charset="utf-8"><p>Missing ${name}. Reinstall FocusGuard.</p>`;
  }
}

export const adminPage = (): string => page('admin.html');

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] ?? character));
}

const HEADLINES: Record<string, string> = {
  shorts: 'Reels and shorts are off right now',
  game: 'Games are off right now',
  budget: "Today's video time is used up",
  break: 'Time for a short break',
};

/** The page a blocked tab lands on. It is the only part of FocusGuard most
 *  people ever see, so it says what happened and when it comes back, names no
 *  authority figure, and never scolds. */
export function blockedPage(reason: string, detail: string, until: string, note = ''): string {
  let untilText = '';
  if (until) {
    const date = new Date(until);
    if (!Number.isNaN(date.getTime())) {
      const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const sameDay = date.toDateString() === new Date().toDateString();
      untilText = sameDay
        ? `Back at ${time}`
        : `Back at ${time} on ${date.toLocaleDateString([], { weekday: 'long' })}`;
    }
  }
  return page('blocked.html')
    .replace('{{headline}}', escapeHtml(HEADLINES[reason] ?? 'Blocked during focus time'))
    .replace('{{detail}}', escapeHtml(detail))
    .replace('{{until}}', escapeHtml(untilText))
    .replace('{{note}}', note ? ` · ${escapeHtml(note)}` : '');
}
