'use strict';

// First-run setup wizard. Drives:
//   1. Discover meowcoin.conf (auto, or prompt for path)
//   2. Probe RPC and detect network (mainnet/testnet) + consensus (apex/legacy)
//   3. Ask for payout address, validate against the detected network
//   4. Choose a stratum port + default difficulty
//   5. Write config.json
//
// Goal: 30 seconds end-to-end for the common case where Meowcoin Core is
// already running with a default conf.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

function detectLanIp() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal && iface.address) return iface.address;
        }
    }
    return '127.0.0.1';
}

const { autoDiscoverRpc, parseConf, DEFAULT_MAINNET_PORT, DEFAULT_TESTNET_PORT } = require('./conf');
const { probeNode } = require('./probe');
const { validateCoinbaseAddress } = require('./address');

const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
};

function color(s, ...codes) {
    if (!process.stdout.isTTY) return s;
    return codes.join('') + s + C.reset;
}

function banner() {
    return [
        color('  ╭───────────────────────────────────────────────────╮', C.cyan),
        color('  │  ', C.cyan) + color('MeowSolo', C.bold, C.cyan) + color(' — Meowcoin solo-mining stratum     │', C.cyan),
        color('  │  ', C.cyan) + color('first-run setup wizard', C.dim) + color('                            │', C.cyan),
        color('  ╰───────────────────────────────────────────────────╯', C.cyan),
        '',
    ].join('\n');
}

function makePrompt() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return {
        ask: (q, def) => new Promise((resolve) => {
            const suffix = def ? color(` [${def}]`, C.dim) : '';
            rl.question(color(q, C.bold) + suffix + ' ', (a) => {
                resolve((a || '').trim() || def || '');
            });
        }),
        yesNo: (q, def = true) => new Promise((resolve) => {
            const hint = def ? '[Y/n]' : '[y/N]';
            rl.question(color(q, C.bold) + ' ' + color(hint, C.dim) + ' ', (a) => {
                const t = (a || '').trim().toLowerCase();
                if (!t) return resolve(def);
                resolve(t === 'y' || t === 'yes');
            });
        }),
        close: () => rl.close(),
    };
}

async function run({ configPath, force = false } = {}) {
    if (!force && fs.existsSync(configPath)) {
        const exists = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return { existing: true, config: exists, configPath };
    }

    process.stdout.write(banner());

    const p = makePrompt();
    try {
        // ── Step 1: locate meowcoin.conf ────────────────────────────────────
        let rpc = autoDiscoverRpc();
        if (rpc && rpc.user && rpc.password) {
            process.stdout.write(color('✓', C.green) + ` Found Meowcoin Core config at ${color(rpc.confPath, C.dim)}\n`);
            process.stdout.write(`  RPC: ${rpc.host}:${rpc.port}  user: ${rpc.user}  network: ${rpc.isTestnet ? 'testnet' : 'mainnet'}\n`);
        } else if (rpc) {
            process.stdout.write(color('!', C.yellow) + ` Found meowcoin.conf but no rpcuser/rpcpassword set, and no .cookie file.\n`);
            process.stdout.write(color('  ', C.dim) + `Add these lines to ${rpc.confPath} and restart Meowcoin Core:\n`);
            process.stdout.write(color('    server=1\n    rpcuser=meow\n    rpcpassword=<a-long-random-string>\n', C.dim));
            const cont = await p.yesNo('  Enter RPC credentials manually instead?', false);
            if (!cont) throw new Error('aborted by user — fix meowcoin.conf and re-run');
            rpc = await askRpcManually(p, rpc);
        } else {
            process.stdout.write(color('?', C.yellow) + ` No meowcoin.conf found in the default locations.\n`);
            process.stdout.write(color('  Meowcoin Core stores it at:\n', C.dim));
            if (process.platform === 'win32') process.stdout.write(color('    %APPDATA%\\Meowcoin\\meowcoin.conf\n', C.dim));
            else if (process.platform === 'darwin') process.stdout.write(color('    ~/Library/Application Support/Meowcoin/meowcoin.conf\n', C.dim));
            else process.stdout.write(color('    ~/.meowcoin/meowcoin.conf\n', C.dim));
            const manualPath = await p.ask('  Path to your meowcoin.conf (leave blank to enter creds manually):', '');
            if (manualPath && fs.existsSync(manualPath)) {
                const parsed = parseConf(fs.readFileSync(manualPath, 'utf8'));
                rpc = {
                    host: parsed.rpcconnect || parsed.rpcbind || '127.0.0.1',
                    port: parseInt(parsed.rpcport, 10) || DEFAULT_MAINNET_PORT,
                    user: parsed.rpcuser || null,
                    password: parsed.rpcpassword || null,
                    isTestnet: parsed.testnet === '1' || parsed.testnet4 === '1',
                };
                if (!rpc.user || !rpc.password) rpc = await askRpcManually(p, rpc);
            } else {
                rpc = await askRpcManually(p, null);
            }
        }

        // ── Step 2: probe the daemon ─────────────────────────────────────────
        process.stdout.write('\n' + color('› Testing RPC connection...', C.cyan) + '\n');
        const probe = await probeNode(rpc);
        if (!probe.ok) {
            process.stdout.write(color('✗ ' + probe.friendlyError, C.red) + '\n');
            if (probe.hint) process.stdout.write(color('  ' + probe.hint, C.dim) + '\n');
            throw new Error(probe.friendlyError);
        }
        process.stdout.write(color('✓', C.green) + ` Connected. ${probe.subversion} on ${color(probe.network, C.bold)} chain, height ${probe.height}.\n`);
        process.stdout.write(color('  Consensus detected: ', C.dim) + color(probe.consensus.toUpperCase(), C.bold) + '\n');

        // ── Step 3: payout address ──────────────────────────────────────────
        process.stdout.write('\n');
        let coinbase = null;
        while (!coinbase) {
            const ans = await p.ask(`Payout address (your ${probe.network === 'mainnet' ? 'M-prefix' : probe.network} Meowcoin address):`);
            if (!ans) {
                process.stdout.write(color('  An address is required — Core won\'t pay solo block rewards anywhere else.\n', C.yellow));
                continue;
            }
            const v = validateCoinbaseAddress(ans, probe.network);
            if (v.ok) {
                if (v.warning) process.stdout.write(color('  ! ' + v.warning, C.yellow) + '\n');
                coinbase = ans;
            } else {
                process.stdout.write(color('  ✗ ' + v.message, C.red) + '\n');
            }
        }

        // ── Step 4: stratum port + difficulty ────────────────────────────────
        process.stdout.write('\n');
        const defaultStratumPort = probe.network === 'mainnet' ? 3333 : 3334;
        const defaultDiff = probe.network === 'mainnet' ? 100000 : 1000;
        const stratumPort = parseInt(await p.ask('Stratum port for miners to connect to:', String(defaultStratumPort)), 10) || defaultStratumPort;
        const stratumDiff = parseInt(await p.ask('Initial share difficulty (raise this if you have a lot of hashrate):', String(defaultDiff)), 10) || defaultDiff;

        // ── Step 5: dashboard port ──────────────────────────────────────────
        const dashboardPort = parseInt(await p.ask('Web dashboard port (http://localhost:PORT):', '8080'), 10) || 8080;

        // ── Build config ────────────────────────────────────────────────────
        // Note: devAddress / devRewardPercent are no longer here. Post-APEX
        // Meowcoin enforces the community fund split at the consensus layer
        // (the daemon's GBT carries CommunityAutonomousAddress + Value).
        // Coinbase.js honours those fields directly.
        const config = {
            consensus: probe.consensus,
            network: probe.network,
            coinbaseAddress: coinbase,
            blockBrand: probe.network === 'mainnet' ? 'MeowSolo Miner' : 'MeowSolo Testnet Miner',
            host: '0.0.0.0',
            port: { number: stratumPort, diff: stratumDiff },
            rpc: { host: rpc.host, port: rpc.port, user: rpc.user, password: rpc.password },
            jobUpdateInterval: 55,
            blockPollIntervalMs: 250,
            blockLogFile: 'block_finds.xlsx',
            dashboard: { enabled: true, port: dashboardPort },
        };

        process.stdout.write('\n' + color('› Writing config to ' + configPath + ' ...', C.cyan) + '\n');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        process.stdout.write(color('✓ All set.\n', C.green));
        process.stdout.write('\n');
        const lanIp = detectLanIp();
        process.stdout.write(color('Point your miner at ', C.dim) + color(`stratum+tcp://${lanIp}:${stratumPort}`, C.bold) + '\n');
        if (lanIp !== '127.0.0.1') {
            process.stdout.write(color('  (or ', C.dim) + color(`stratum+tcp://127.0.0.1:${stratumPort}`, C.bold) + color(' from this same PC)', C.dim) + '\n');
        }
        process.stdout.write(color('Open dashboard at  ', C.dim) + color(`http://localhost:${dashboardPort}`, C.bold) + '\n');
        process.stdout.write('\n');

        return { existing: false, config, configPath };
    } finally {
        p.close();
    }
}

async function askRpcManually(p, partial) {
    const host = await p.ask('RPC host:', (partial && partial.host) || '127.0.0.1');
    const port = parseInt(await p.ask('RPC port:', String((partial && partial.port) || DEFAULT_MAINNET_PORT)), 10);
    const user = await p.ask('RPC user (rpcuser in meowcoin.conf):', (partial && partial.user) || '');
    const password = await p.ask('RPC password (rpcpassword in meowcoin.conf):', (partial && partial.password) || '');
    return { host, port, user, password, isTestnet: port === DEFAULT_TESTNET_PORT };
}

module.exports = { run };
