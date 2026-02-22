/**
 * Self-contained HTML page shell for the RTL preview.
 *
 * Features:
 * - RTL layout with Noto Naskh Arabic font (Google Fonts, system fallback)
 * - Al-Jazari palette: brass, crimson, lapis, sky-blue, gold, ivory
 * - WebSocket auto-reconnect with connection status badge
 * - Scroll position preservation across updates
 * - All CSS inline — zero external dependencies besides optional font
 */

import { AR_LABELS } from './arabic-keys.js';

/**
 * Generate the full HTML page.
 *
 * @param port      Preview server port
 * @param docUri    The document URI (for WS subscription)
 * @param content   Initial rendered HTML content
 */
export function htmlShell(port: number, docUri: string, content: string): string {
    const wsUrl = `ws://localhost:${port}/ws?doc=${encodeURIComponent(docUri)}`;

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Almadar Preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --brass: #B87333;
  --crimson: #DC2626;
  --lapis: #1E40AF;
  --sky: #0EA5E9;
  --gold: #C8A951;
  --ivory: #FFFBEB;
  --bg: #1a1a2e;
  --card-bg: #16213e;
  --text: #e8e8e8;
  --text-muted: #a0a0b0;
  --border: #2a2a4a;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Noto Naskh Arabic', 'Amiri', 'Traditional Arabic', 'Scheherazade New', serif;
  background: var(--bg);
  color: var(--text);
  line-height: 2;
  font-size: 17px;
  padding: 2rem;
  max-width: 960px;
  margin: 0 auto;
}

/* Connection status */
#status {
  position: fixed;
  top: 12px;
  left: 12px;
  padding: 4px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  z-index: 100;
  transition: all 0.3s;
  font-family: 'Noto Naskh Arabic', serif;
}
#status.connected { background: #065f46; color: #a7f3d0; }
#status.disconnected { background: #7f1d1d; color: #fca5a5; }

/* Schema name */
.schema-name {
  color: var(--gold);
  font-size: 2.2rem;
  font-weight: 700;
  margin-bottom: 0.3rem;
  border-bottom: 3px solid var(--gold);
  padding-bottom: 0.5rem;
}
.schema-desc {
  color: var(--text-muted);
  font-size: 1rem;
  margin: 0.8rem 0 1.5rem;
  line-height: 2;
  padding: 1rem;
  background: var(--card-bg);
  border-radius: 8px;
  border-right: 4px solid var(--gold);
}
.version-badge {
  display: inline-block;
  background: var(--card-bg);
  color: var(--text-muted);
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

/* Orbital sections */
.orbital {
  margin: 2rem 0;
  padding: 1.5rem;
  background: var(--card-bg);
  border-radius: 12px;
  border: 1px solid var(--border);
}
.orbital-name {
  color: var(--sky);
  font-size: 1.5rem;
  margin-bottom: 1rem;
}

/* Entity */
.entity-block {
  margin: 1rem 0;
  padding: 1rem;
  background: rgba(14, 165, 233, 0.08);
  border-radius: 8px;
  border-right: 3px solid var(--sky);
}
.entity-name { color: var(--sky); font-size: 1.2rem; margin-bottom: 0.3rem; }
.entity-meta { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.8rem; }
.entity-meta code { background: rgba(255,255,255,0.1); padding: 1px 6px; border-radius: 4px; font-family: monospace; }

/* Fields table */
.fields-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
  margin-top: 0.5rem;
}
.fields-table th {
  background: rgba(14, 165, 233, 0.15);
  color: var(--sky);
  padding: 6px 10px;
  text-align: right;
  border-bottom: 2px solid var(--border);
  font-weight: 600;
}
.fields-table td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.fields-table tr:hover { background: rgba(255,255,255,0.03); }
.field-name { color: var(--gold); font-weight: 600; }
.field-structure { color: var(--text-muted); font-size: 0.82rem; max-width: 250px; }
.enum-values { color: var(--brass); font-size: 0.85rem; }
.badge-required {
  background: var(--crimson);
  color: white;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 0.78rem;
  font-weight: 600;
}

/* Traits */
.traits-section h3, .pages-section h3 {
  color: var(--brass);
  font-size: 1.2rem;
  margin: 1.2rem 0 0.5rem;
  border-bottom: 1px solid var(--brass);
  padding-bottom: 0.3rem;
}
.trait-block {
  margin: 1rem 0;
  padding: 1rem;
  background: rgba(184, 115, 51, 0.08);
  border-radius: 8px;
  border-right: 3px solid var(--brass);
}
.trait-name { color: var(--brass); font-size: 1.1rem; margin-bottom: 0.2rem; }
.trait-meta { color: var(--text-muted); font-size: 0.88rem; margin-bottom: 0.8rem; }

/* State machine */
.sm-section { margin: 0.8rem 0; }
.sm-label { color: var(--text-muted); font-weight: 600; font-size: 0.9rem; display: block; margin-bottom: 0.3rem; }

/* State pills */
.state-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.state-pill {
  display: inline-block;
  padding: 4px 14px;
  border-radius: 20px;
  font-size: 0.88rem;
  font-weight: 600;
  background: rgba(184, 115, 51, 0.2);
  color: var(--brass);
  border: 1px solid var(--brass);
}
.state-initial {
  border-color: var(--gold);
  color: var(--gold);
  background: rgba(200, 169, 81, 0.2);
  box-shadow: 0 0 8px rgba(200, 169, 81, 0.3);
}
.state-terminal {
  border-style: dashed;
  border-color: var(--text-muted);
  color: var(--text-muted);
}

/* Event tags */
.event-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.event-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 0.82rem;
  font-family: monospace;
  background: rgba(30, 64, 175, 0.15);
  color: var(--lapis);
  border: 1px solid rgba(30, 64, 175, 0.3);
}

/* Transitions */
.transition-block {
  margin: 0.8rem 0;
  padding: 0.8rem;
  background: rgba(255,255,255,0.03);
  border-radius: 6px;
  border-right: 2px solid var(--border);
}
.transition-header { font-weight: 600; font-size: 0.95rem; margin-bottom: 0.3rem; }
.state-ref { color: var(--brass); }
.arrow { color: var(--text-muted); margin: 0 4px; }
.transition-event { color: var(--lapis); }

/* Principle */
.principle {
  color: var(--gold);
  font-style: italic;
  font-size: 0.9rem;
  margin: 0.3rem 0;
  padding: 0.3rem 0.8rem;
  border-right: 2px solid var(--gold);
  background: rgba(200, 169, 81, 0.08);
  border-radius: 0 4px 4px 0;
}

/* Guards */
.guards-block { margin: 0.4rem 0; }
.guard-label { color: var(--crimson); font-weight: 600; font-size: 0.85rem; }
.guard-sexpr { border-right-color: var(--crimson); }

/* Effects */
.effects-block { margin: 0.4rem 0; }
.effect-label { color: var(--lapis); font-weight: 600; font-size: 0.85rem; }
.effect-sexpr { border-right-color: var(--lapis); }

/* S-expressions */
.sexpr {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.82rem;
  line-height: 1.6;
  background: rgba(0,0,0,0.3);
  padding: 0.5rem 0.8rem;
  border-radius: 4px;
  border-right: 2px solid var(--border);
  overflow-x: auto;
  white-space: pre;
  direction: ltr;
  text-align: left;
}
.sexpr-op { color: var(--brass); font-weight: 700; }
.sexpr-binding { color: var(--sky); }
.sexpr-string { color: #a5d6a7; }
.sexpr-literal { color: #ffcc80; }
.sexpr-null { color: var(--text-muted); }
.sexpr-key { color: var(--gold); }
.sexpr-bracket { color: var(--text-muted); }

/* Pages */
.page-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.3rem 0;
  font-size: 0.92rem;
}
.page-name { color: var(--gold); font-weight: 600; }
.page-path { font-family: monospace; color: var(--lapis); }
.page-refs { color: var(--text-muted); }

/* Error */
.error-block {
  padding: 1.5rem;
  background: rgba(220, 38, 38, 0.1);
  border: 1px solid var(--crimson);
  border-radius: 8px;
  margin: 1rem 0;
}
.error-block h2 { color: var(--crimson); margin-bottom: 0.5rem; }
.error-block pre { font-family: monospace; font-size: 0.9rem; color: #fca5a5; white-space: pre-wrap; direction: ltr; text-align: left; }

/* Document closed message */
.closed-message {
  text-align: center;
  padding: 3rem;
  color: var(--text-muted);
  font-size: 1.3rem;
}

/* Markdown content styles */
h1 { color: var(--gold); font-size: 2rem; margin: 1.5rem 0 0.5rem; border-bottom: 2px solid var(--gold); padding-bottom: 0.3rem; }
h2 { color: var(--sky); font-size: 1.5rem; margin: 1.3rem 0 0.5rem; }
h3 { color: var(--brass); font-size: 1.2rem; margin: 1rem 0 0.4rem; }
h4 { color: var(--text); font-size: 1.05rem; margin: 0.8rem 0 0.3rem; }
p { margin: 0.6rem 0; }
blockquote {
  border-right: 4px solid var(--gold);
  padding: 0.8rem 1.2rem;
  margin: 1rem 0;
  background: rgba(200, 169, 81, 0.08);
  color: var(--gold);
  font-size: 1.05rem;
  border-radius: 0 6px 6px 0;
}
ul, ol { padding-right: 1.5rem; margin: 0.5rem 0; }
li { margin: 0.2rem 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
.code-block {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  background: rgba(0,0,0,0.3);
  padding: 0.8rem 1rem;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.85rem;
  line-height: 1.5;
  direction: ltr;
  text-align: left;
  margin: 0.8rem 0;
}
.inline-code {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  background: rgba(255,255,255,0.1);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.88em;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.8rem 0;
  font-size: 0.92rem;
}
table th {
  background: rgba(14, 165, 233, 0.12);
  color: var(--sky);
  padding: 6px 10px;
  text-align: right;
  border-bottom: 2px solid var(--border);
}
table td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
}
strong { color: var(--gold); }
em { color: var(--text-muted); font-style: italic; }
</style>
</head>
<body>
<div id="status" class="disconnected">${AR_LABELS.disconnected}</div>
<div id="content">${content}</div>
<script>
(function() {
  var wsUrl = ${JSON.stringify(wsUrl)};
  var statusEl = document.getElementById('status');
  var contentEl = document.getElementById('content');
  var ws = null;
  var reconnectTimer = null;
  var RECONNECT_MS = 2000;

  function connect() {
    if (ws) { try { ws.close(); } catch(e) {} }
    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      statusEl.textContent = ${JSON.stringify(AR_LABELS.connected)};
      statusEl.className = 'connected';
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };

    ws.onmessage = function(evt) {
      try {
        var msg = JSON.parse(evt.data);
        if (msg.type === 'update') {
          var scrollY = window.scrollY;
          contentEl.innerHTML = msg.html;
          window.scrollTo(0, scrollY);
        } else if (msg.type === 'closed') {
          contentEl.innerHTML = '<div class="closed-message">${AR_LABELS.documentClosed}</div>';
        }
      } catch(e) { console.error('WS parse error', e); }
    };

    ws.onclose = function() {
      statusEl.textContent = ${JSON.stringify(AR_LABELS.disconnected)};
      statusEl.className = 'disconnected';
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      }
    };

    ws.onerror = function() {
      ws.close();
    };
  }

  connect();
})();
</script>
</body>
</html>`;
}
