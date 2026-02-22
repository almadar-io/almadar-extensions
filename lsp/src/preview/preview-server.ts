/**
 * PreviewServer — HTTP + raw WebSocket server for live RTL preview.
 *
 * Embeds inside the LSP process, binds to 127.0.0.1:0 (auto-assigned port),
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
    }

    /** Start listening on 127.0.0.1:0 and write the port file */
    async start(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                    this.log(`PreviewServer listening on http://127.0.0.1:${this.port}`);

                    // Write port file
                    try {
                        fs.writeFileSync(this.portFilePath, String(this.port), 'utf-8');
                        this.log(`Port file: ${this.portFilePath}`);
                    } catch (e) {
                        this.log(`Failed to write port file: ${e}`);
                    }

                    resolve(this.port);
                } else {
                    reject(new Error('Failed to bind'));
                }
            });
            this.server.on('error', reject);
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

    // -----------------------------------------------------------------------
    // HTTP handler
    // -----------------------------------------------------------------------

    private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);

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

            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(page);
            return;
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }

    // -----------------------------------------------------------------------
    // WebSocket upgrade
    // -----------------------------------------------------------------------

    private handleUpgrade(req: http.IncomingMessage, socket: net.Socket): void {
        const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);

        if (url.pathname !== '/ws') {
            socket.destroy();
            return;
        }

        const docUri = url.searchParams.get('doc');
        if (!docUri) {
            socket.destroy();
            return;
        }

        // WebSocket handshake
        const key = req.headers['sec-websocket-key'];
        if (!key) {
            socket.destroy();
            return;
        }

        const acceptKey = crypto
            .createHash('sha1')
            .update(key + '258EAFA5-E914-47DA-95CA-5AB9B140E115')
            .digest('base64');

        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
            '\r\n',
        );

        const client: WsClient = { socket, docUri };
        this.clients.push(client);
        this.log(`WS client connected for: ${docUri}`);

        // Handle incoming frames (pings, close)
        let buffer = Buffer.alloc(0);
        socket.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length > 0) {
                const frame = readFrame(buffer);
                if (!frame) break;
                buffer = buffer.subarray(frame.bytesConsumed);

                if (frame.opcode === 0x08) {
                    // Close frame — echo it back
                    const closeFrame = Buffer.alloc(2);
                    closeFrame[0] = 0x88; // FIN + close
                    closeFrame[1] = 0x00;
                    try { socket.write(closeFrame); } catch { /* ignore */ }
                    socket.end();
                } else if (frame.opcode === 0x09) {
                    // Ping — respond with pong
                    const pong = Buffer.alloc(2 + frame.payload.length);
                    pong[0] = 0x8a; // FIN + pong
                    pong[1] = frame.payload.length;
                    frame.payload.copy(pong, 2);
                    try { socket.write(pong); } catch { /* ignore */ }
                }
                // Ignore text/binary frames from client
            }
        });

        socket.on('close', () => {
            this.clients = this.clients.filter((c) => c !== client);
            this.log(`WS client disconnected for: ${docUri}`);
        });

        socket.on('error', () => {
            this.clients = this.clients.filter((c) => c !== client);
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
