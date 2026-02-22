/**
 * PreviewServer — HTTP + WebSocket server for live RTL preview.
 *
 * Embeds inside the LSP process, binds to localhost:0 (auto-assigned port),
 * serves rendered HTML previews, and pushes live updates via WebSocket.
 *
 * Supports two modes:
 * - **Pinned**: `/preview?doc=<uri>` — locked to one document
 * - **Follow**: `/preview` (no doc param) — auto-follows the active editor file
 *
 * Uses the `ws` library for WebSocket handling.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { renderOrb } from './orb-renderer.js';
import { renderMarkdown } from './md-renderer.js';
import { htmlShell } from './html-shell.js';
import { AR_LABELS } from './arabic-keys.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Sentinel value for clients that follow the active document */
const FOLLOW = '__follow__';

interface WsClient {
    ws: WebSocket;
    docUri: string; // document URI or FOLLOW
}

interface DocState {
    uri: string;
    text: string;
    html: string;
}

type LogFn = (message: string) => void;

// ---------------------------------------------------------------------------
// PreviewServer
// ---------------------------------------------------------------------------

export class PreviewServer {
    private server: http.Server;
    private wss: WebSocketServer;
    private port = 0;
    private clients: WsClient[] = [];
    private documents = new Map<string, DocState>();
    private activeUri: string | null = null;
    private log: LogFn;
    private portFilePath: string;

    constructor(log: LogFn) {
        this.log = log;
        this.portFilePath = path.join(
            process.env['TMPDIR'] ?? process.env['TMP'] ?? '/tmp',
            `almadar-preview-${process.pid}.port`,
        );
        this.server = http.createServer(this.handleHttp.bind(this));
        this.wss = new WebSocketServer({ noServer: true });

        this.server.on('upgrade', (req, socket, head) => {
            const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);

            if (url.pathname !== '/ws') {
                socket.destroy();
                return;
            }

            // doc param is optional — without it, client enters follow mode
            const docUri = url.searchParams.get('doc') ?? FOLLOW;

            this.wss.handleUpgrade(req, socket, head, (ws) => {
                const mode = docUri === FOLLOW ? 'follow' : 'pinned';
                this.log(`WS client connected (${mode}): ${docUri === FOLLOW ? 'follow' : docUri}`);
                const client: WsClient = { ws, docUri };
                this.clients.push(client);

                // In follow mode, immediately send the current active document
                if (docUri === FOLLOW && this.activeUri) {
                    const doc = this.documents.get(this.activeUri);
                    if (doc) {
                        ws.send(JSON.stringify({ type: 'switch', uri: this.activeUri, html: doc.html }));
                    }
                }

                ws.on('close', () => {
                    this.clients = this.clients.filter((c) => c !== client);
                    this.log(`WS client disconnected (${mode})`);
                });

                ws.on('error', (err) => {
                    this.log(`WS error (${mode}): ${err.message}`);
                    this.clients = this.clients.filter((c) => c !== client);
                });
            });
        });
    }

    /** Start listening on loopback:0 (dual-stack IPv4+IPv6) and write the port file */
    async start(): Promise<number> {
        this.cleanStalePortFiles();

        return new Promise((resolve, reject) => {
            this.server.listen(0, '::', () => {
                const addr = this.server.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                    this.log(`PreviewServer listening on http://localhost:${this.port}`);

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

        // Update active document tracking
        this.activeUri = uri;

        // Push to pinned subscribers (watching this exact URI)
        this.pushToSubscribers(uri, { type: 'update', html });

        // Push to follow-mode subscribers (watching whatever is active)
        this.pushToFollowers({ type: 'switch', uri, html });
    }

    /** Notify that a document was closed */
    notifyDocumentClosed(uri: string): void {
        this.documents.delete(uri);
        this.pushToSubscribers(uri, { type: 'closed' });

        // If the closed doc was active, clear it
        if (this.activeUri === uri) {
            this.activeUri = null;
        }
    }

    /** Stop the server and clean up */
    stop(): void {
        for (const client of this.clients) {
            try { client.ws.close(); } catch { /* ignore */ }
        }
        this.clients = [];

        this.wss.close();
        this.server.close();

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
                try {
                    process.kill(pid, 0);
                } catch {
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

        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                port: this.port,
                activeUri: this.activeUri,
                documents: Array.from(this.documents.keys()),
            }));
            return;
        }

        if (url.pathname === '/preview') {
            const docUri = url.searchParams.get('doc');

            // Follow mode (no doc param) — show the active document
            if (!docUri) {
                let content: string;
                if (this.activeUri) {
                    const doc = this.documents.get(this.activeUri);
                    content = doc?.html ?? `<div class="closed-message">${AR_LABELS.noContent}</div>`;
                } else {
                    content = `<div class="closed-message">${AR_LABELS.noContent}</div>`;
                }
                const page = htmlShell(this.port, null, content);

                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store',
                });
                res.end(page);
                return;
            }

            // Pinned mode — show a specific document
            let doc = this.documents.get(docUri);
            if (!doc) {
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

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
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
        return `<pre style="direction: ltr; text-align: left;">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
    }

    /** Push to clients pinned to a specific document URI */
    private pushToSubscribers(uri: string, message: Record<string, unknown>): void {
        const payload = JSON.stringify(message);
        const deadClients: WsClient[] = [];

        for (const client of this.clients) {
            if (client.docUri === uri) {
                try {
                    if (client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(payload);
                    }
                } catch {
                    deadClients.push(client);
                }
            }
        }

        if (deadClients.length > 0) {
            this.clients = this.clients.filter((c) => !deadClients.includes(c));
        }
    }

    /** Push to follow-mode clients */
    private pushToFollowers(message: Record<string, unknown>): void {
        const payload = JSON.stringify(message);
        const deadClients: WsClient[] = [];

        for (const client of this.clients) {
            if (client.docUri === FOLLOW) {
                try {
                    if (client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(payload);
                    }
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
