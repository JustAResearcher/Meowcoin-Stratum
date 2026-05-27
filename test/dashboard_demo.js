#!/usr/bin/env node
'use strict';

// Standalone dashboard demo with fake mining activity. Lets you eyeball the
// UI without needing Meowcoin Core running.
//   PORT=8080 node test/dashboard_demo.js

const EventEmitter = require('events');
const Stratum = require('../libs/class.Stratum');
const { DashboardState } = require('../libs/dashboard/state');
const { DashboardServer } = require('../libs/dashboard/server');

class FakeStratum extends EventEmitter {}
const fake = new FakeStratum();

const state = new DashboardState({
    stratum: fake,
    startedAt: Date.now() - 5 * 60 * 1000, // pretend we've been up 5 minutes
    config: {
        consensus: 'apex',
        network: 'mainnet',
        port: { number: 3333, diff: 100000 },
        rpc: { host: '127.0.0.1', port: 9766 },
        coinbaseAddress: 'MFMrgv31Z3mTs2DehcTht2rgrnn41B6PzT',
        devRewardPercent: 40,
    },
});

state.setChain({
    network: 'mainnet',
    consensus: 'apex',
    subversion: '/Meowcoin Core:4.0.0/APEX/',
    height: 2_456_789,
});

const port = parseInt(process.env.PORT || '8080', 10);
const server = new DashboardServer({ state, port, host: '127.0.0.1' });
server.start(() => {
    console.log(`Dashboard demo listening on http://localhost:${port}`);
});

// Fake workers — push events the DashboardState understands
const workers = [
    { name: 'rig01.001', ip: '192.168.1.10', hashrateScale: 0.4 },
    { name: 'rig02.001', ip: '192.168.1.11', hashrateScale: 1.0 },
    { name: 'rig03.001', ip: '192.168.1.12', hashrateScale: 0.8 },
    { name: 'desk-gpu',  ip: '192.168.1.20', hashrateScale: 0.15 },
];

function fakeClient(w) {
    return {
        workerName: w.name,
        socket: { remoteAddress: w.ip },
        minerAddress: 'MFMrgv31Z3mTs2DehcTht2rgrnn41B6PzT',
    };
}

// Authorize all
for (const w of workers) {
    fake.emit(Stratum.EVENT_CLIENT_AUTHORIZE, { client: fakeClient(w) });
}

// Fake new-job
let h = 2_456_789;
function emitJob(newBlock) {
    fake.emit(Stratum.EVENT_NEXT_JOB, {
        job: { idHex: Math.random().toString(16).slice(2, 18), height: h },
        isNewBlock: !!newBlock,
    });
}
emitJob(true);

// Random share generator
function emitShare(w, valid, isBlock = false) {
    const diff = 100000;
    const shareDiff = isBlock ? diff * 10000 : diff * (0.5 + Math.random());
    fake.emit(Stratum.EVENT_SHARE_SUBMITTED, {
        client: fakeClient(w),
        share: {
            client: fakeClient(w),
            isValidShare: !!valid,
            isValidBlock: !!isBlock,
            shareDiff,
            stratumDiff: diff,
            jobHeight: h,
            nonceHex: Math.random().toString(16).slice(2, 18),
            blockTxId: isBlock ? 'a'.repeat(64) : '',
            error: valid ? null : { message: 'low difficulty share' },
        },
    });
}

// Drive activity
setInterval(() => {
    for (const w of workers) {
        // Hashrate scale ≈ shares per tick
        const rolls = Math.max(1, Math.round(w.hashrateScale * 3));
        for (let i = 0; i < rolls; i++) {
            const ok = Math.random() > 0.04;
            emitShare(w, ok);
        }
    }
}, 1000);

// New block every 30s
setInterval(() => {
    h++;
    emitJob(true);
}, 30_000);

// Found block every 90s
setInterval(() => {
    const w = workers[Math.floor(Math.random() * workers.length)];
    emitShare(w, true, true);
}, 90_000);

// Occasional disconnect/reconnect
setInterval(() => {
    const w = workers[Math.floor(Math.random() * workers.length)];
    fake.emit(Stratum.EVENT_CLIENT_DISCONNECT, { client: fakeClient(w), reason: 'timeout' });
    setTimeout(() => fake.emit(Stratum.EVENT_CLIENT_AUTHORIZE, { client: fakeClient(w) }), 4000);
}, 45_000);
