/**
 * PreviewServer — HTTP + raw WebSocket server for live RTL preview.
 *
 * Embeds inside the LSP process, binds to localhost:0 (auto-assigned port),
 * serves rendered HTML previews, and pushes live updates via WebSocket.
 *
 * Zero external dependencies — uses Node built-in `http` and `crypto`.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { renderOrb } from './orb-renderer.js';
import { renderMarkdown } from './md-renderer.js';
import { htmlShell } from './html-shell.js';
import { AR_LABELS } from './arabic-keys.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WsClient {
    socket: net.Socket;
    docUri: string;
}

interface DocState {
    uri: string;
    text: string;
    html: string;
}

type LogFn = (message: string) => void;

// ---------------------------------------------------------------------------
// WebSocket frame helpers (RFC 6455)
// ---------------------------------------------------------------------------

/** Build a text frame to send from server → client (no masking needed) */
function buildTextFrame(payload: string): Buffer {
    const data = Buffer.from(payload, 'utf-8');
    const len = data.length;

    let header: Buffer;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // FIN + text opcode
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        // Write as two 32-bit values (JS safe integer range)
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(len, 6);
    }

    return Buffer.concat([header, data]);
}

/** Read a WebSocket frame from client → server (masked) */
function readFrame(buf: Buffer): { opcode: number; payload: Buffer; bytesConsumed: number } | null {
    if (buf.length < 2) return null;

    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let payloadLen = buf[1] & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
        if (buf.length < 4) return null;
        payloadLen = buf.readUInt16BE(2);
        offset = 4;
    } else if (payloadLen === 127) {
        if (buf.length < 10) return null;
        payloadLen = buf.readUInt32BE(6); // ignore high 32 bits
        offset = 10;
    }

    const maskSize = masked ? 4 : 0;
    const totalLen = offset + maskSize + payloadLen;
    if (buf.length < totalLen) return null;

    let payload: Buffer;
    if (masked) {
        const maskKey = buf.subarray(offset, offset + 4);
        payload = Buffer.alloc(payloadLen);
        const dataStart = offset + 4;
        for (let i = 0; i < payloadLen; i++) {
            payload[i] = buf[dataStart + i] ^ maskKey[i % 4];
        }
    } else {
        payload = buf.subarray(offset, offset + payloadLen);
    }

    return { opcode, payload, bytesConsumed: totalLen };
}

// ---------------------------------------------------------------------------
// PreviewServer
// ---------------------------------------------------------------------------

export class PreviewServer {
    private server: http.Server;
    private port = 0;
    private clients: WsClient[] = [];
    private documents = new Map<string, DocState>();
    private log: LogFn;
    private portFilePath: string;

    constructor(log: LogFn) {
        this.log = log;
        this.portFilePath = path.join(
            process.env['TMPDIR'] ?? process.env['TMP'] ?? '/tmp',
            `almadar-preview-${process.pid}.port`,
        );
        this.server = http.createServer(this.handleHttp.bind(this));
        this.server.on('upgrade', this.handleUpgrade.bind(this));

        // TRACE: log every raw TCP connection
        this.server.on('connection', (socket: net.Socket) => {
            const remote = `${socket.remoteAddress}:${socket.remotePort}`;
            this.log(`[TRACE] TCP connection from ${remote}`);
            socket.on('error', (err) => {
                this.log(`[TRACE] TCP socket error from ${remote}: ${err.message}`);
            });
        });

        // TRACE: log server-level errors
        this.server.on('error', (err) => {
            this.log(`[TRACE] Server error: ${err.message}`);
        });

        // TRACE: log clientError (malformed requests, TLS on plain HTTP, etc.)
        this.server.on('clientError', (err, socket) => {
            this.log(`[TRACE] Client error: ${err.message}`);
            if (socket.writable) {
                socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
            }
        });

        this.log('[TRACE] PreviewServer constructor complete');
    }

    /** Start listening on loopback:0 (dual-stack IPv4+IPv6) and write the port file */
    async start(): Promise<number> {
        // Clean up stale port files from dead processes
        this.cleanStalePortFiles();

        return new Promise((resolve, reject) => {
            this.log('[TRACE] About to call server.listen(0, "::")');

            // Bind to '::' for dual-stack (IPv4 + IPv6) so browsers using
            // either localhost→::1 or localhost→127.0.0.1 can connect.
            this.server.listen(0, '::', () => {
                const addr = this.server.address();
                this.log(`[TRACE] server.address() = ${JSON.stringify(addr)}`);

                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                    this.log(`PreviewServer listening on http://localhost:${this.port}`);
                    this.log(`[TRACE] Address family: ${addr.family}, address: ${addr.address}`);

                    // Write port file (with trailing newline for clean cat output)
                    try {
                        fs.writeFileSync(this.portFilePath, this.port + '\n', 'utf-8');
                        this.log(`Port file: ${this.portFilePath}`);
                    } catch (e) {
                        this.log(`Failed to write port file: ${e}`);
                    }

                    resolve(this.port);
                } else {
                    reject(new Error('Failed to bind'));
                }
            });
            this.server.on('error', (err) => {
                this.log(`[TRACE] Listen error: ${err.message}`);
                reject(err);
            });
        });
    }

    /** Get the port number */
    getPort(): number {
        return this.port;
    }

    /** Notify that a document changed — re-render and push to subscribers */
    notifyDocumentChanged(uri: string, text: string): void {
        const html = this.renderDocument(uri, text);
        this.documents.set(uri, { uri, text, html });
        this.log(`[TRACE] Document changed: ${uri} (${this.clients.length} WS clients total)`);
        this.pushToSubscribers(uri, { type: 'update', html });
    }

    /** Notify that a document was closed */
    notifyDocumentClosed(uri: string): void {
        this.documents.delete(uri);
        this.pushToSubscribers(uri, { type: 'closed' });
    }

    /** Stop the server and clean up */
    stop(): void {
        // Close all WS connections
        for (const client of this.clients) {
            try { client.socket.destroy(); } catch { /* ignore */ }
        }
        this.clients = [];

        this.server.close();

        // Remove port file
        try { fs.unlinkSync(this.portFilePath); } catch { /* ignore */ }
    }

    /** Remove port files from previous processes that are no longer running */
    private cleanStalePortFiles(): void {
        const tmpDir = path.dirname(this.portFilePath);
        try {
            const files = fs.readdirSync(tmpDir);
            for (const file of files) {
                const match = file.match(/^almadar-preview-(\d+)\.port$/);
                if (!match) continue;
                const pid = Number(match[1]);
                if (pid === process.pid) continue;
                // Check if the process is still alive
                try {
                    process.kill(pid, 0); // signal 0 = existence check
                } catch {
                    // Process is dead — remove its stale port file
                    const staleFile = path.join(tmpDir, file);
                    try {
                        fs.unlinkSync(staleFile);
                        this.log(`Cleaned stale port file: ${staleFile}`);
                    } catch { /* ignore */ }
                }
            }
        } catch { /* ignore errors reading tmpdir */ }
    }

    // -----------------------------------------------------------------------
    // HTTP handler
    // -----------------------------------------------------------------------

    private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
        this.log(`[TRACE] HTTP ${req.method} ${url.pathname} from ${req.socket.remoteAddress}`);
        this.log(`[TRACE] HTTP headers: ${JSON.stringify(req.headers)}`);

        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                port: this.port,
                documents: Array.from(this.documents.keys()),
            }));
            return;
        }

        if (url.pathname === '/preview') {
            const docUri = url.searchParams.get('doc');
            if (!docUri) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Missing ?doc= parameter');
                return;
            }

            // Get or create initial content
            let doc = this.documents.get(docUri);
            if (!doc) {
                // Try to load from filesystem
                const filePath = this.uriToFilePath(docUri);
                if (filePath && fs.existsSync(filePath)) {
                    const text = fs.readFileSync(filePath, 'utf-8');
                    const html = this.renderDocument(docUri, text);
                    doc = { uri: docUri, text, html };
                    this.documents.set(docUri, doc);
                }
            }

            const content = doc?.html ?? `<div class="closed-message">${AR_LABELS.noContent}</div>`;
            const page = htmlShell(this.port, docUri, content);

            this.log(`[TRACE] Serving preview page (${page.length} bytes) for: ${docUri}`);

            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(page);
            return;
        }

        // 404
        this.log(`[TRACE] 404 for path: ${url.pathname}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }

    // -----------------------------------------------------------------------
    // WebSocket upgrade
    // -----------------------------------------------------------------------

    private handleUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
        this.log(`[TRACE] === WS UPGRADE START ===`);
        this.log(`[TRACE] WS upgrade URL: ${req.url}`);
        this.log(`[TRACE] WS upgrade headers: ${JSON.stringify(req.headers)}`);
        this.log(`[TRACE] WS head buffer length: ${head.length}`);
        this.log(`[TRACE] WS socket remote: ${socket.remoteAddress}:${socket.remotePort}`);
        this.log(`[TRACE] WS socket writable: ${socket.writable}, destroyed: ${socket.destroyed}`);

        const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);

        if (url.pathname !== '/ws') {
            this.log('[TRACE] WS upgrade REJECTED: wrong path');
            socket.destroy();
            return;
        }

        const docUri = url.searchParams.get('doc');
        if (!docUri) {
            this.log('[TRACE] WS upgrade REJECTED: no doc param');
            socket.destroy();
            return;
        }

        // WebSocket handshake
        const key = req.headers['sec-websocket-key'];
        if (!key) {
            this.log('[TRACE] WS upgrade REJECTED: no sec-websocket-key');
            socket.destroy();
            return;
        }

        this.log(`[TRACE] WS key: ${key}`);

        const acceptKey = crypto
            .createHash('sha1')
            .update(key + '258EAFA5-E914-47DA-95CA-5AB9B140E115')
            .digest('base64');

        this.log(`[TRACE] WS accept key: ${acceptKey}`);

        const handshake =
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
            '\r\n';

        this.log(`[TRACE] WS sending handshake (${handshake.length} bytes)...`);

        const writeResult = socket.write(handshake);
        this.log(`[TRACE] WS socket.write() returned: ${writeResult}`);
        this.log(`[TRACE] WS socket writable after write: ${socket.writable}, destroyed: ${socket.destroyed}`);

        const client: WsClient = { socket, docUri };
        this.clients.push(client);
        this.log(`[TRACE] WS client added. Total clients: ${this.clients.length}`);
        this.log(`[TRACE] === WS UPGRADE COMPLETE ===`);

        // Handle incoming frames (pings, close)
        // Start with the head buffer — it may contain initial frame data
        let buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);

        socket.on('data', (chunk: Buffer) => {
            this.log(`[TRACE] WS data received: ${chunk.length} bytes, opcode peek: 0x${chunk[0]?.toString(16)}`);
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length > 0) {
                const frame = readFrame(buffer);
                if (!frame) break;
                buffer = buffer.subarray(frame.bytesConsumed);

                this.log(`[TRACE] WS frame: opcode=0x${frame.opcode.toString(16)}, payload=${frame.payload.length} bytes`);

                if (frame.opcode === 0x08) {
                    // Close frame — echo it back
                    this.log(`[TRACE] WS close frame received`);
                    const closeFrame = Buffer.alloc(2);
                    closeFrame[0] = 0x88; // FIN + close
                    closeFrame[1] = 0x00;
                    try { socket.write(closeFrame); } catch { /* ignore */ }
                    socket.end();
                } else if (frame.opcode === 0x09) {
                    // Ping — respond with pong
                    this.log(`[TRACE] WS ping received, sending pong`);
                    const pong = Buffer.alloc(2 + frame.payload.length);
                    pong[0] = 0x8a; // FIN + pong
                    pong[1] = frame.payload.length;
                    frame.payload.copy(pong, 2);
                    try { socket.write(pong); } catch { /* ignore */ }
                }
                // Ignore text/binary frames from client
            }
        });

        socket.on('close', (hadError: boolean) => {
            this.clients = this.clients.filter((c) => c !== client);
            this.log(`[TRACE] WS socket closed for: ${docUri}, hadError: ${hadError}`);
        });

        socket.on('error', (err) => {
            this.log(`[TRACE] WS socket ERROR for ${docUri}: ${err.message}`);
            this.log(`[TRACE] WS error stack: ${err.stack}`);
            this.clients = this.clients.filter((c) => c !== client);
        });

        socket.on('end', () => {
            this.log(`[TRACE] WS socket END for: ${docUri}`);
        });
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    private renderDocument(uri: string, text: string): string {
        const lowerUri = uri.toLowerCase();
        if (lowerUri.endsWith('.orb')) {
            return renderOrb(text);
        }
        if (lowerUri.endsWith('.md')) {
            return renderMarkdown(text);
        }
        // Fallback: render as preformatted text
        return `<pre style="direction: ltr; text-align: left;">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
    }

    private pushToSubscribers(uri: string, message: Record<string, unknown>): void {
        const frame = buildTextFrame(JSON.stringify(message));
        const deadClients: WsClient[] = [];

        this.log(`[TRACE] Pushing to subscribers of ${uri}: ${this.clients.filter(c => c.docUri === uri).length} matched of ${this.clients.length} total`);

        for (const client of this.clients) {
            if (client.docUri === uri) {
                try {
                    client.socket.write(frame);
                } catch {
                    deadClients.push(client);
                }
            }
        }

        if (deadClients.length > 0) {
            this.clients = this.clients.filter((c) => !deadClients.includes(c));
        }
    }

    private uriToFilePath(uri: string): string | null {
        if (uri.startsWith('file://')) {
            return decodeURIComponent(uri.slice(7));
        }
        return null;
    }
}
