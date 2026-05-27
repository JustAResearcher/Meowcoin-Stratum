// Dashboard frontend — no framework, vanilla JS. Subscribes to /api/events (SSE)
// and re-renders on every state push.

const $ = (id) => document.getElementById(id);

function fmtHashrate(hs) {
    if (!hs || !isFinite(hs)) return '0 H/s';
    const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
    let i = 0;
    while (hs >= 1000 && i < units.length - 1) { hs /= 1000; i++; }
    return hs.toFixed(hs >= 100 ? 0 : hs >= 10 ? 1 : 2) + ' ' + units[i];
}

function fmtAgo(ts) {
    if (!ts) return 'never';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
}

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function fmtUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m`;
    return `${m}m ${s % 60}s`;
}

let lastEventAt = 0;

function setConn(state, label) {
    const el = $('conn-status');
    el.className = 'conn ' + state;
    el.textContent = label;
}

function render(snap) {
    lastEventAt = Date.now();
    const net = (snap.chain && snap.chain.network) || (snap.config && snap.config.network) || 'mainnet';
    const tag = $('net-tag');
    tag.textContent = net;
    tag.className = 'tag tag-net-' + net;

    const t = snap.totals;
    $('kpi-hashrate').textContent = fmtHashrate(t.hashrateHs);
    $('kpi-workers').textContent = snap.workers.length;

    if (snap.chain && snap.chain.height != null) {
        $('kpi-height').textContent = snap.chain.height.toLocaleString();
    } else if (snap.currentJob) {
        $('kpi-height').textContent = snap.currentJob.height.toLocaleString();
    } else {
        $('kpi-height').textContent = '—';
    }
    $('kpi-job').textContent = snap.currentJob
        ? `job ${snap.currentJob.idHex.slice(0, 8)}… (${fmtAgo(snap.currentJob.at)})`
        : 'no job yet';

    $('kpi-valid').textContent = t.valid.toLocaleString();
    $('kpi-invalid').textContent = t.invalid.toLocaleString();

    const uptimeS = (snap.now - snap.startedAt) / 1000;
    const rate = uptimeS > 0 ? (t.shares / uptimeS) * 60 : 0;
    $('kpi-share-rate').textContent = rate.toFixed(1) + ' shares/min';

    $('kpi-blocks').textContent = t.blocks.toLocaleString();

    // Workers table
    const tbody = $('workers-body');
    if (!snap.workers.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">No workers connected yet. Point your miner at the stratum URL below.</td></tr>';
    } else {
        tbody.innerHTML = snap.workers.map((w) => `
            <tr>
                <td><span class="online-dot ${w.online ? 'on' : ''}"></span>${escape(w.name)}</td>
                <td class="mono">${escape(w.ip || '')}</td>
                <td class="num">${fmtHashrate(w.hashrateHs)}</td>
                <td class="num">${w.currentDiff ? w.currentDiff.toLocaleString() : '—'}</td>
                <td class="num"><span class="ok">${w.sharesValid || 0}</span></td>
                <td class="num"><span class="bad">${w.sharesInvalid || 0}</span></td>
                <td>${fmtAgo(w.lastShareAt)}</td>
            </tr>
        `).join('');
    }

    // Recent shares
    const shares = $('shares-list');
    if (!snap.recentShares.length) {
        shares.innerHTML = '<li class="empty">No shares yet.</li>';
    } else {
        shares.innerHTML = snap.recentShares.map((s) => {
            const cls = s.block ? 'block' : s.ok ? 'ok' : 'bad';
            const tag = s.block ? '★ BLOCK' : s.ok ? 'accepted' : (s.error || 'rejected');
            return `<li>
                <span class="dot ${cls}"></span>
                <span class="time">${fmtTime(s.ts)}</span>
                <span class="who">${escape(s.worker)}</span>
                <span class="meta">diff ${Math.round(s.diff).toLocaleString()} · ${escape(tag)}</span>
            </li>`;
        }).join('');
    }

    // Blocks
    const blocks = $('blocks-list');
    if (!snap.blocks.length) {
        blocks.innerHTML = '<li class="empty">No blocks yet. You\'ll see them here when your miner finds one.</li>';
    } else {
        blocks.innerHTML = snap.blocks.map((b) => `
            <li>
                <span class="dot block"></span>
                <span class="time">${fmtTime(b.ts)}</span>
                <span class="who">#${b.height.toLocaleString()}</span>
                <span class="meta">${escape(b.worker)} · ${b.txid ? b.txid.slice(0, 16) + '…' : 'pending verify'}</span>
            </li>
        `).join('');
    }

    // Config card
    const host = snap.config.lanIp || '127.0.0.1';
    const stratumUrl = `stratum+tcp://${host}:${snap.config.stratumPort || '?'}`;
    $('info-stratum').textContent = stratumUrl;
    $('info-coinbase').textContent = snap.config.coinbaseAddress || '—';
    $('info-rpc').textContent = (snap.config.rpcHost && snap.config.rpcPort)
        ? `${snap.config.rpcHost}:${snap.config.rpcPort}` + (snap.chain ? ` · ${escape(snap.chain.subversion || '')}` : '')
        : '—';
    $('info-consensus').textContent = (snap.config.consensus || '—').toUpperCase();
    $('info-fund').textContent = snap.config.devRewardPercent
        ? `${snap.config.devRewardPercent}% of each block`
        : 'off';
    $('info-uptime').textContent = fmtUptime(snap.now - snap.startedAt);
}

function escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function connect() {
    setConn('stale', 'connecting…');
    fetch('/api/state').then((r) => r.json()).then(render).catch(() => {});

    const es = new EventSource('/api/events');
    es.addEventListener('state', (ev) => {
        try { render(JSON.parse(ev.data)); setConn('live', 'live'); } catch (_) {}
    });
    es.onerror = () => {
        setConn('dead', 'reconnecting…');
        setTimeout(() => { try { es.close(); } catch (_) {} connect(); }, 2000);
    };
    es.onopen = () => setConn('live', 'live');
}

// Keep "last share / uptime" ticking even between SSE pushes.
setInterval(() => {
    if (lastEventAt && (Date.now() - lastEventAt) > 10000) setConn('stale', 'idle');
    // tick relative timestamps
    document.querySelectorAll('[data-ago]').forEach((el) => {
        el.textContent = fmtAgo(parseInt(el.getAttribute('data-ago'), 10));
    });
}, 1000);

connect();
