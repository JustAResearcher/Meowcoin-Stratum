#!/usr/bin/env node
'use strict';

// MeowSolo single entry point.
//
// Usage:
//   meowsolo                  — run with ./config.json (wizard on first run)
//   meowsolo init             — re-run the setup wizard, even if config exists
//   meowsolo --testnet        — testnet defaults during wizard (otherwise honoured from config.network)
//   meowsolo --no-dashboard   — skip the web dashboard
//   meowsolo --config PATH    — use a non-default config file location
//   meowsolo --port N         — override dashboard port
//
// On startup we friendly-fail any of the common breakages:
//   - meowcoin.conf not found
//   - Meowcoin Core not running (ECONNREFUSED)
//   - RPC user/pass mismatch (401)
//   - Address on wrong network
//   - Stratum port already in use

process.on('uncaughtException', (err) => {
    console.error('\n[FATAL] Uncaught exception:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('\n[FATAL] Unhandled rejection:', reason);
});

const fs = require('fs');
const path = require('path');

const Stratum = require('../libs/class.Stratum');
const { BlockLogger, getBlockSubsidy, COMMUNITY_FUND_PCT } = require('../libs/class.BlockLogger');
const { run: runWizard } = require('../libs/setup/wizard');
const { probeNode } = require('../libs/setup/probe');
const { validateCoinbaseAddress } = require('../libs/setup/address');
const { DashboardState } = require('../libs/dashboard/state');
const { DashboardServer } = require('../libs/dashboard/server');

const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};
const tty = process.stdout.isTTY;
const c = (s, ...codes) => tty ? codes.join('') + s + C.reset : s;

function parseArgs(argv) {
    const out = { cmd: null, flags: {} };
    const args = argv.slice(2);
    let i = 0;
    if (args[0] && !args[0].startsWith('-')) {
        out.cmd = args[0];
        i = 1;
    }
    for (; i < args.length; i++) {
        const a = args[i];
        if (a === '--testnet') out.flags.testnet = true;
        else if (a === '--no-dashboard') out.flags.noDashboard = true;
        else if (a === '--config') out.flags.config = args[++i];
        else if (a === '--port') out.flags.dashboardPort = parseInt(args[++i], 10);
        else if (a === '-h' || a === '--help') out.flags.help = true;
        else if (a === '-v' || a === '--version') out.flags.version = true;
        else { console.error('Unknown option:', a); process.exit(2); }
    }
    return out;
}

function printHelp() {
    console.log(`MeowSolo — Meowcoin solo-mining stratum server

USAGE
  meowsolo                  Run mining (interactive wizard on first run)
  meowsolo init             Re-run the setup wizard
  meowsolo --testnet        Default to testnet during the wizard
  meowsolo --no-dashboard   Skip the local web dashboard
  meowsolo --config PATH    Use a non-default config.json
  meowsolo --port N         Override dashboard port
  meowsolo --version        Print version
  meowsolo --help           This message
`);
}

function findConfigPath(flagPath) {
    if (flagPath) return path.resolve(flagPath);
    // pkg-bundled binary's cwd is where the user double-clicked / cd'd to.
    return path.resolve(process.cwd(), 'config.json');
}

async function bootstrapConfig({ configPath, force }) {
    if (!force && fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (err) {
            console.error(c('✗ config.json is not valid JSON: ' + err.message, C.red));
            console.error(c('  Either fix it or delete it and re-run to get the wizard back.', C.dim));
            process.exit(1);
        }
    }
    const { config } = await runWizard({ configPath, force: true });
    return config;
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.flags.help) { printHelp(); return; }
    if (args.flags.version) {
        console.log('meowsolo ' + require('../package.json').version);
        return;
    }

    const configPath = findConfigPath(args.flags.config);
    const force = args.cmd === 'init';
    const config = await bootstrapConfig({ configPath, force });

    if (args.flags.dashboardPort) {
        config.dashboard = config.dashboard || {};
        config.dashboard.port = args.flags.dashboardPort;
    }
    if (args.flags.noDashboard) {
        config.dashboard = { enabled: false };
    }
    if (args.cmd === 'init') {
        // Just ran wizard; exit cleanly so the user can start fresh.
        return;
    }

    // ── Pre-flight: validate config & test RPC before starting the stratum
    if (!config.coinbaseAddress) {
        console.error(c('✗ config.json has no coinbaseAddress.', C.red));
        console.error(c('  Run `meowsolo init` to set one.', C.dim));
        process.exit(1);
    }
    const addrCheck = validateCoinbaseAddress(config.coinbaseAddress, config.network || 'mainnet');
    if (!addrCheck.ok) {
        console.error(c('✗ Invalid coinbaseAddress: ' + addrCheck.message, C.red));
        console.error(c('  Run `meowsolo init` to fix.', C.dim));
        process.exit(1);
    }

    console.log(c('› Testing Meowcoin Core RPC...', C.cyan));
    const probe = await probeNode(config.rpc);
    if (!probe.ok) {
        console.error(c('✗ ' + probe.friendlyError, C.red));
        if (probe.hint) console.error(c('  ' + probe.hint, C.dim));
        process.exit(1);
    }
    console.log(c('✓', C.green) + ` Meowcoin Core ${probe.subversion} on ${c(probe.network, C.bold)} at ${config.rpc.host}:${config.rpc.port} (height ${probe.height}).`);

    if (probe.consensus !== config.consensus) {
        console.warn(c(`! Consensus mismatch: node looks like ${probe.consensus.toUpperCase()} but config says ${(config.consensus || '').toUpperCase()}.`, C.yellow));
        console.warn(c('  Continuing with config value. If blocks get rejected, run `meowsolo init` to refresh.', C.dim));
    }

    // ── Spin up the stratum
    const stratum = new Stratum(config);
    const blockLogger = new BlockLogger({ filepath: config.blockLogFile || 'block_finds.xlsx' });
    const dashboardState = new DashboardState({ stratum, config, startedAt: Date.now() });
    dashboardState.setChain({
        network: probe.network,
        consensus: probe.consensus,
        subversion: probe.subversion,
        height: probe.height,
    });

    stratum.init(() => {
        const stratumPort = (config.port && config.port.number) || 3333;
        console.log(c('✓', C.green) + ` Stratum listening on ${c(`0.0.0.0:${stratumPort}`, C.bold)}.`);
        console.log(c('  Point your miner at: ', C.dim) + c(`stratum+tcp://<this-pc>:${stratumPort}`, C.bold));
    });

    let dashboardServer = null;
    if (!config.dashboard || config.dashboard.enabled !== false) {
        const dashPort = (config.dashboard && config.dashboard.port) || 8080;
        dashboardServer = new DashboardServer({ state: dashboardState, port: dashPort, host: '127.0.0.1' });
        dashboardServer.start(() => {
            console.log(c('✓', C.green) + ` Dashboard: ${c('http://localhost:' + dashPort, C.bold)}`);
        });
    }

    // Stay friendly in the console too — share/block logs.
    stratum.on(Stratum.EVENT_CLIENT_AUTHORIZE, (ev) => {
        console.log(c('+ worker connected: ', C.dim) + ev.client.workerName);
    });
    stratum.on(Stratum.EVENT_CLIENT_DISCONNECT, (ev) => {
        const name = ev.client && ev.client.workerName;
        if (name) console.log(c('- worker left:    ', C.dim) + name);
    });
    stratum.on(Stratum.EVENT_NEXT_JOB, (ev) => {
        if (ev.isNewBlock) console.log(c(`▸ new block height=${ev.job.height} job=${ev.job.idHex.slice(0, 8)}…`, C.cyan));
    });
    stratum.on(Stratum.EVENT_SHARE_SUBMITTED, (ev) => {
        const s = ev.share;
        if (s.isValidBlock) {
            console.log(c(`★ BLOCK FOUND by ${s.client.workerName} at height ${s.jobHeight}!`, C.green, C.bold));
            const subsidy = getBlockSubsidy(s.jobHeight);
            const communityShare = Math.floor((subsidy * COMMUNITY_FUND_PCT) / 100);
            const minerReward = subsidy - communityShare;
            blockLogger.logBlock({
                height: s.jobHeight,
                rewardSat: minerReward,
                feeSat: 0,
                txidHex: s.blockTxId || '',
                worker: s.client.workerName,
                nonceHex: s.nonceHex,
            });
        } else if (!s.isValidShare && s.error) {
            // Only log invalid shares — valid ones would flood the console.
            console.log(c(`✗ invalid share from ${s.client.workerName}: ${s.error.message}`, C.yellow));
        }
    });

    // Graceful shutdown
    const shutdown = () => {
        console.log(c('\n› Shutting down...', C.dim));
        stratum.destroy(() => {
            dashboardServer && dashboardServer.stop(() => process.exit(0));
            if (!dashboardServer) process.exit(0);
        });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error(c('\n✗ Startup failed: ' + (err.message || err), C.red));
    if (err.stack) console.error(c(err.stack, C.dim));
    process.exit(1);
});
