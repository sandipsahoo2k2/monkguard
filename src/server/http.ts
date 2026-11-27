import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { Engine } from '../app/engine.js';
import { mayReachFromNetwork } from '../domain/access.js';
import { isHex } from '../infra/credentials.js';
import { allowedHosts, hostIsAllowed, isLoopback, isOnOurNetwork } from '../infra/network.js';
import { currentNetwork } from '../platform/macos/wifi.js';
import { listenOnFreePort } from '../infra/ports.js';
import { FileStore, log } from '../infra/store.js';
import { adminPage, blockedPage } from './pages.js';
import { buildRoutes } from './routes.js';

const TOKEN_LIFETIME_MS = 14 * 86_400_000;
const MAX_LOGIN_ATTEMPTS = 8;          // per device
const MAX_LOGIN_ATTEMPTS_TOTAL = 40;   // across the whole network
const LOGIN_WINDOW_MS = 600_000;
const MAX_BODY_BYTES = 512 * 1024;
const NONCE_LIFETIME_MS = 120_000;

/** Nothing is loaded from anywhere else, and nothing can be sent anywhere else. */
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    + "img-src data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cache-control': 'no-store',
};

/**
 * Transport only: addresses, cookies, bodies and status codes. It knows nothing
 * about focus time, which is why the rules can be tested without a socket.
 */
export class AdminServer {
  /** token → when it expires and which device it was issued to. */
  private readonly tokens = new Map<string, { expires: number; client: string }>();
  private readonly attempts = new Map<string, number[]>();
  /** One-time numbers handed out for login, so a captured answer is worthless. */
  private readonly nonces = new Map<string, number>();
  private readonly routes: ReturnType<typeof buildRoutes>;
  private hosts = new Set<string>();
  private server: Server | null = null;

  constructor(private readonly store: FileStore, engine: Engine) {
    this.routes = buildRoutes(store, engine);
  }

  /** Starts on the saved port, or the next free one. Returns the port in use,
   *  or null when the admin page could not start at all. */
  async listen(): Promise<number | null> {
    const server = createServer((request, response) => {
      this.handle(request, response).catch((error: Error) => {
        log(`request failed: ${error.message}`);
        if (!response.headersSent) this.sendJson(response, 500, { error: 'something went wrong' });
      });
    });
    const { bindAddress, serverPort } = this.store.get();
    const bind = bindAddress || '0.0.0.0';

    let port: number;
    try {
      port = await listenOnFreePort(server, serverPort, bind);
    } catch (error) {
      log(`the admin page is off: ${(error as Error).message}. The guard itself keeps running.`);
      return null;
    }
    server.on('error', (error) => log(`admin server error: ${error.message}`));
    this.server = server;
    this.hosts = allowedHosts(port, hostname().replace(/\.local$/i, ''));
    this.store.recordListening(port);
    log(`admin page listening on ${bind}:${port}`
      + (bind === '127.0.0.1' ? ' (this Mac only)' : ' (this wifi network only)'));
    return port;
  }

  close(): void {
    this.server?.close();
    this.server?.closeAllConnections();
  }

  private refuse(response: ServerResponse, why: string): void {
    response.writeHead(403, { 'content-type': 'text/plain', ...SECURITY_HEADERS });
    response.end(`${why}\n`);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const client = (request.socket.remoteAddress ?? '').replace(/^::ffff:/, '');

    // Only this Mac and the devices sharing its network, not every private
    // address that might reach it over a VPN or a guest network.
    if (!isOnOurNetwork(client)) {
      return this.refuse(response, 'MonkGuard only answers devices on the same wifi network.');
    }

    // And on a strange network, not even those: a laptop in a cafe shares its
    // network with strangers, and nobody should have to remember that.
    if (!isLoopback(client)) {
      const network = await currentNetwork();
      const decision = mayReachFromNetwork(this.store.get(), network.id);
      if (!decision.allowed) return this.refuse(response, decision.reason);
    }

    // A request addressed to a name we do not answer to is the signature of DNS
    // rebinding: a web page pointing its own domain at this Mac so its scripts
    // can talk to the admin page from inside somebody's browser.
    if (!hostIsAllowed(request.headers.host, this.hosts)) {
      return this.refuse(response, 'Unexpected address. Use this Mac\'s name or its address on your wifi.');
    }

    const url = new URL(request.url ?? '/', 'http://localhost');
    const key = `${request.method ?? 'GET'} ${url.pathname}`;

    // Nothing may post here from another page, even with a stolen cookie.
    const origin = request.headers.origin;
    if (request.method === 'POST' && origin) {
      const expected = `http://${request.headers.host}`;
      if (origin !== expected) return this.refuse(response, 'Requests from other pages are not accepted.');
    }

    // The pages a blocked browser lands on, and the login: no cookie needed.
    if (key === 'GET /' || key === 'GET /index.html') return this.sendHtml(response, adminPage());
    if (key === 'GET /blocked') {
      return this.sendHtml(response, blockedPage(
        url.searchParams.get('reason') ?? '',
        url.searchParams.get('detail') ?? '',
        url.searchParams.get('until') ?? '',
        this.store.get().blockPageNote,
      ));
    }
    if (key === 'GET /healthz') return this.sendJson(response, 200, { ok: true });
    if (key === 'GET /api/challenge') return this.challenge(response);
    if (key === 'POST /api/login') return this.login(request, response, client);
    if (key === 'POST /api/logout') {
      this.tokens.delete(this.cookies(request).monkguard_token ?? '');
      return this.sendJson(response, 200, { ok: true });
    }

    if (!this.authorised(request, client)) return this.sendJson(response, 401, { error: 'pin required' });

    const route = this.routes[key];
    if (!route) return this.sendJson(response, 404, { error: 'not found' });

    const body = request.method === 'POST' ? await AdminServer.readBody(request) : {};
    const result = route(body);
    if (key === 'POST /api/pin' && result.status === 200) this.forgetAllSessions();
    return this.sendJson(response, result.status, result.body);
  }

  /** Hands out the salt to derive the verifier from, and a number to sign. */
  private challenge(response: ServerResponse): void {
    const now = Date.now();
    for (const [value, issued] of this.nonces) {
      if (now - issued > NONCE_LIFETIME_MS) this.nonces.delete(value);
    }
    if (this.nonces.size > 50) this.nonces.clear();

    const nonce = randomBytes(16).toString('hex');
    this.nonces.set(nonce, now);
    const { salt, iterations } = this.store.challengeFor();
    this.sendJson(response, 200, { nonce, salt, iterations });
  }

  /** Counted per device, so one phone guessing cannot lock everybody else out,
   *  with a looser ceiling for the whole network as a backstop. */
  private tooManyAttempts(client: string): boolean {
    const now = Date.now();
    let total = 0;
    for (const [who, times] of this.attempts) {
      const recent = times.filter((at) => now - at < LOGIN_WINDOW_MS);
      if (recent.length === 0) this.attempts.delete(who);
      else this.attempts.set(who, recent);
      total += recent.length;
    }
    const mine = this.attempts.get(client) ?? [];
    mine.push(now);
    this.attempts.set(client, mine);
    return mine.length > MAX_LOGIN_ATTEMPTS || total + 1 > MAX_LOGIN_ATTEMPTS_TOTAL;
  }

  private async login(request: IncomingMessage, response: ServerResponse, client: string): Promise<void> {
    if (this.tooManyAttempts(client)) {
      this.store.appendEvent({
        kind: 'login_blocked', subject: client, detail: 'too many attempts, locked for ten minutes',
      });
      return this.sendJson(response, 429, { error: 'too many tries, wait ten minutes' });
    }

    const body = await AdminServer.readBody(request);
    const nonce = String(body.nonce ?? '');
    const issued = this.nonces.get(nonce);
    this.nonces.delete(nonce);                       // one use, whatever happens next

    if (issued === undefined || Date.now() - issued > NONCE_LIFETIME_MS) {
      return this.sendJson(response, 401, { error: 'that login expired, try again' });
    }
    if (!isHex(body.proof, 32) || !this.store.checkProof(nonce, body.proof)) {
      this.store.appendEvent({ kind: 'login_failed', subject: client, detail: 'wrong PIN' });
      return this.sendJson(response, 401, { error: 'wrong PIN' });
    }

    const token = randomBytes(24).toString('hex');
    this.tokens.set(token, { expires: Date.now() + TOKEN_LIFETIME_MS, client });
    this.attempts.delete(client);
    response.setHeader('set-cookie',
      `monkguard_token=${token}; Path=/; Max-Age=${TOKEN_LIFETIME_MS / 1000}; SameSite=Lax; HttpOnly`);
    return this.sendJson(response, 200, { ok: true });
  }

  /** A session belongs to the device it was issued to: a copied cookie is of no
   *  use from another phone on the same wifi. */
  private authorised(request: IncomingMessage, client: string): boolean {
    const token = this.cookies(request).monkguard_token;
    if (!token) return false;
    const session = this.tokens.get(token);
    if (!session) return false;
    if (session.expires < Date.now() || session.client !== client) {
      this.tokens.delete(token);
      return false;
    }
    this.tokens.set(token, { expires: Date.now() + TOKEN_LIFETIME_MS, client });
    return true;
  }

  /** Every session ends when the PIN changes, which is what makes changing it
   *  a useful thing to do if somebody has been watching over a shoulder. */
  private forgetAllSessions(): void {
    this.tokens.clear();
  }

  private cookies(request: IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pair of (request.headers.cookie ?? '').split(';')) {
      const index = pair.indexOf('=');
      if (index > 0) out[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
    }
    return out;
  }

  private static async readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) break;
      chunks.push(chunk as Buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private sendJson(response: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(text),
      ...SECURITY_HEADERS,
    });
    response.end(text);
  }

  private sendHtml(response: ServerResponse, html: string): void {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(html),
      ...SECURITY_HEADERS,
    });
    response.end(html);
  }
}
