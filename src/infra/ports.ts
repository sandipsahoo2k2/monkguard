import { Server } from 'node:http';
import { connect } from 'node:net';

/** How many ports are tried, counting up from the preferred one. */
export const PORT_ATTEMPTS = 20;

function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (answered: boolean) => { socket.destroy(); resolve(answered); };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/**
 * True when something on this Mac already accepts connections on the port.
 *
 * Trying to bind is not enough of a test: macOS lets a server listening on every
 * address share a port with one that listens on localhost only, and the other
 * app would then receive the requests made on this Mac.
 */
async function isTaken(port: number): Promise<boolean> {
  return (await Promise.all([accepts('127.0.0.1', port), accepts('::1', port)])).some(Boolean);
}

function tryListen(server: Server, port: number, bind: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error) => { server.off('listening', started); reject(error); };
    const started = () => { server.off('error', failed); resolve(); };
    server.once('error', failed);
    server.once('listening', started);
    server.listen(port, bind);
  });
}

/** Listens on the preferred port, or the next free one above it. */
export async function listenOnFreePort(server: Server, preferred: number, bind: string): Promise<number> {
  const last = Math.min(preferred + PORT_ATTEMPTS - 1, 65_535);
  for (let port = preferred; port <= last; port += 1) {
    if (await isTaken(port)) continue;
    try {
      await tryListen(server, port, bind);
      return port;
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw error;
    }
  }
  throw new Error(`no free port between ${preferred} and ${last}`);
}
