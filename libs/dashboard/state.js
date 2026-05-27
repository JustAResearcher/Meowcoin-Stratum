'use strict';

// Live state for the dashboard. Subscribes to the Stratum event firehose and
// maintains:
//   - workers: Map(workerName → { ip, hashrateHs, lastShareAt, sharesValid, sharesInvalid, currentDiff })
//   - shares:  ring buffer of last N shares (timestamp, worker, diff, ok)
//   - blocks:  list of blocks found since startup
//   - chain:   last-known network info (height, network, consensus, subversion)
//
// Anyone (HTTP server, future telemetry export) reads from `getSnapshot()`.
// Emits 'change' on every update so the dashboard SSE stream stays live.

const EventEmitter = require('events');
const Stratum = require('../class.Stratum');

const SHARE_BUFFER = 200;
const BLOCK_BUFFER = 50;
const HASHRATE_WINDOW_MS = 5 * 60 * 1000; // 5-minute trailing window for hashrate estimate

class DashboardState extends EventEmitter {
    constructor({ stratum, startedAt, config }) {
        super();
        this._stratum = stratum;
        this._startedAt = startedAt || Date.now();
        this._config = config || {};

        this._workers = new Map();
        this._shares = [];
        this._blocks = [];
        this._chain = null;
        this._currentJob = null;

        this._totalShares = 0;
        this._totalValid = 0;
        this._totalInvalid = 0;
        this._totalBlocks = 0;

        this._wire(stratum);
    }

    setChain(info) {
        this._chain = info;
        this._touch();
    }

    _wire(stratum) {
        stratum.on(Stratum.EVENT_CLIENT_AUTHORIZE, (ev) => {
            const client = ev.client;
            const w = this._ensureWorker(client.workerName, client.socket.remoteAddress);
            w.connectedAt = Date.now();
            this._touch();
        });

        stratum.on(Stratum.EVENT_CLIENT_DISCONNECT, (ev) => {
            const name = ev.client && ev.client.workerName;
            if (name && this._workers.has(name)) {
                const w = this._workers.get(name);
                w.disconnectedAt = Date.now();
                w.online = false;
            }
            this._touch();
        });

        stratum.on(Stratum.EVENT_SHARE_SUBMITTED, (ev) => {
            const share = ev.share;
            const worker = share.client && share.client.workerName;
            const ts = Date.now();

            this._totalShares++;

            const record = {
                ts,
                worker: worker || '(unknown)',
                diff: share.shareDiff || share.stratumDiff || 0,
                ok: !!share.isValidShare || !!share.isValidBlock,
                block: !!share.isValidBlock,
                height: share.jobHeight || 0,
                error: share.error && share.error.message,
            };

            if (record.ok) this._totalValid++;
            else this._totalInvalid++;

            this._shares.push(record);
            if (this._shares.length > SHARE_BUFFER) this._shares.shift();

            if (worker) {
                const w = this._ensureWorker(worker, share.client.socket.remoteAddress);
                w.lastShareAt = ts;
                w.currentDiff = share.stratumDiff || w.currentDiff;
                if (record.ok) {
                    w.sharesValid = (w.sharesValid || 0) + 1;
                    w.shareEvents.push({ ts, diff: share.shareDiff || share.stratumDiff || 0 });
                    // prune outside the hashrate window
                    const cutoff = ts - HASHRATE_WINDOW_MS;
                    while (w.shareEvents.length && w.shareEvents[0].ts < cutoff) w.shareEvents.shift();
                } else {
                    w.sharesInvalid = (w.sharesInvalid || 0) + 1;
                }
            }

            if (share.isValidBlock) {
                this._totalBlocks++;
                this._blocks.push({
                    ts,
                    height: share.jobHeight,
                    worker: worker || '(unknown)',
                    nonce: share.nonceHex,
                    txid: share.blockTxId || '',
                });
                if (this._blocks.length > BLOCK_BUFFER) this._blocks.shift();
            }

            this._touch();
        });

        stratum.on(Stratum.EVENT_NEXT_JOB, (ev) => {
            this._currentJob = {
                idHex: ev.job.idHex,
                height: ev.job.height,
                isNewBlock: ev.isNewBlock,
                at: Date.now(),
            };
            this._touch();
        });
    }

    _ensureWorker(name, ip) {
        if (!this._workers.has(name)) {
            this._workers.set(name, {
                name,
                ip,
                connectedAt: Date.now(),
                lastShareAt: 0,
                sharesValid: 0,
                sharesInvalid: 0,
                currentDiff: 0,
                shareEvents: [],
                online: true,
            });
        } else {
            const w = this._workers.get(name);
            if (ip) w.ip = ip;
            w.online = true;
        }
        return this._workers.get(name);
    }

    _touch() {
        this.emit('change');
    }

    // Hashrate estimate (hashes per second) using the trailing window of valid shares.
    //   hashrate ≈ Σ(shareDiff × 2^32) / window_seconds
    _estimateHashrate(events) {
        if (!events.length) return 0;
        const now = Date.now();
        const oldest = events[0].ts;
        const windowSec = Math.max(1, (now - oldest) / 1000);
        let sumDiff = 0;
        for (const e of events) sumDiff += e.diff || 0;
        return (sumDiff * 4294967296) / windowSec; // 2^32
    }

    getSnapshot() {
        const workers = [];
        for (const w of this._workers.values()) {
            workers.push({
                name: w.name,
                ip: w.ip,
                online: w.online,
                connectedAt: w.connectedAt,
                lastShareAt: w.lastShareAt,
                sharesValid: w.sharesValid,
                sharesInvalid: w.sharesInvalid,
                currentDiff: w.currentDiff,
                hashrateHs: this._estimateHashrate(w.shareEvents),
            });
        }
        workers.sort((a, b) => b.hashrateHs - a.hashrateHs);

        let totalHashrate = 0;
        for (const w of workers) totalHashrate += w.hashrateHs;

        return {
            startedAt: this._startedAt,
            now: Date.now(),
            chain: this._chain,
            currentJob: this._currentJob,
            totals: {
                shares: this._totalShares,
                valid: this._totalValid,
                invalid: this._totalInvalid,
                blocks: this._totalBlocks,
                hashrateHs: totalHashrate,
            },
            workers,
            recentShares: this._shares.slice(-30).reverse(),
            blocks: this._blocks.slice().reverse(),
            config: {
                consensus: this._config.consensus,
                network: this._config.network,
                stratumPort: this._config.port && this._config.port.number,
                stratumDiff: this._config.port && this._config.port.diff,
                rpcHost: this._config.rpc && this._config.rpc.host,
                rpcPort: this._config.rpc && this._config.rpc.port,
                coinbaseAddress: this._config.coinbaseAddress,
                devRewardPercent: this._config.devRewardPercent,
            },
        };
    }
}

module.exports = { DashboardState };
