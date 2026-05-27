'use strict';

// Tiny dashboard server: serves one HTML page + a JSON snapshot endpoint
// + a Server-Sent Events stream. Single-file dependency: Node's http + fs.
//
// Endpoints:
//   GET /                 — index.html
//   GET /api/state        — JSON snapshot (full state)
//   GET /api/events       — SSE stream; emits 'state' messages on every change

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

class DashboardServer {
    constructor({ state, port = 8080, host = '127.0.0.1' }) {
        this._state = state;
        this._port = port;
        this._host = host;
        this._server = null;
        this._sseClients = new Set();
        this._sseThrottleAt = 0;

        this._state.on('change', () => this._broadcastSSE());
    }

    start(cb) {
        this._server = http.createServer((req, res) => this._handle(req, res));
        // Bind failure must not kill mining — the dashboard is optional.
        this._server.on('error', (err) => cb && cb(err));
        this._server.listen(this._port, this._host, () => {
            this._server.removeAllListeners('error');
            cb && cb(null);
        });
    }

    stop(cb) {
        for (const c of this._sseClients) {
            try { c.end(); } catch (_) { /* noop */ }
        }
        this._sseClients.clear();
        this._server && this._server.close(() => cb && cb());
    }

    _handle(req, res) {
        const url = (req.url || '/').split('?')[0];

        if (url === '/api/state') {
            const snap = this._state.getSnapshot();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(snap));
            return;
        }

        if (url === '/api/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            });
            res.write(':ok\n\n');
            this._sseClients.add(res);
            this._sendSSE(res);
            req.on('close', () => this._sseClients.delete(res));
            return;
        }

        const filename = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
        // prevent path traversal
        const safe = path.normalize(filename).replace(/^(\.\.[\/\\])+/, '');
        const full = path.join(PUBLIC_DIR, safe);
        if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        const ext = path.extname(full).toLowerCase();
        const ctype = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ctype });
        fs.createReadStream(full).pipe(res);
    }

    _broadcastSSE() {
        // Throttle to at most ~10 messages/sec — share floods on a busy farm
        // would otherwise dominate the dashboard's CPU on small machines.
        const now = Date.now();
        if (now - this._sseThrottleAt < 100) return;
        this._sseThrottleAt = now;
        for (const c of this._sseClients) this._sendSSE(c);
    }

    _sendSSE(client) {
        try {
            const snap = this._state.getSnapshot();
            client.write('event: state\ndata: ' + JSON.stringify(snap) + '\n\n');
        } catch (err) {
            this._sseClients.delete(client);
        }
    }
}

module.exports = { DashboardServer };
