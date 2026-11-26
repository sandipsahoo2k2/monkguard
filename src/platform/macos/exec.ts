import { execFile } from 'node:child_process';

/**
 * Everything here is asynchronous on purpose.
 *
 * A synchronous `spawnSync` blocks Node's event loop for as long as the command
 * runs, and the very first AppleScript call sits on the macOS permission dialog
 * until somebody answers it. Blocking there would freeze the admin page exactly
 * when the parent is trying to use it.
 */
export function run(command: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (_error, stdout) => resolve(stdout ?? ''));
  });
}

export interface OsaResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Runs AppleScript from stdin, so the script never has to be shell-quoted. */
export function osascript(source: string, timeoutMs = 8000): Promise<OsaResult> {
  return new Promise((resolve) => {
    const child = execFile('/usr/bin/osascript', ['-'],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (stderr) permissions.note(stderr);
        resolve({ ok: !error, stdout: stdout ?? '', stderr: stderr ?? '' });
      });
    child.stdin?.end(source);
  });
}

export async function notify(title: string, body: string): Promise<void> {
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await osascript(`display notification "${escape(body)}" with title "${escape(title)}"`, 5000);
}

/** Remembers permission failures so the admin page can name the exact switch to
 *  turn on, instead of the service quietly doing nothing for a week. */
class PermissionWatcher {
  private readonly seen = new Map<string, number>();

  note(raw: string): void {
    const text = raw.trim();
    const lower = text.toLowerCase();
    const isPermission = text.includes('-1743') || lower.includes('not allowed')
      || lower.includes('not authorized') || lower.includes('not authorised');
    if (!isPermission) return;
    this.seen.set(text, Date.now());
    if (this.seen.size > 10) this.seen.delete([...this.seen.keys()][0]!);
  }

  current(): string[] {
    const cutoff = Date.now() - 10 * 60_000;
    return [...this.seen.entries()].filter(([, at]) => at > cutoff).map(([text]) => text);
  }
}

export const permissions = new PermissionWatcher();
