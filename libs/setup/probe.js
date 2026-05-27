'use strict';

// Friendly, single-shot RPC probe used by the wizard and at startup.
// Calls getnetworkinfo + getblockchaininfo, distinguishes
// connection-refused / auth-fail / bad-response / chain-mismatch / consensus-mismatch
// with one clear, actionable message per case.

const http = require('http');

const PROBE_TIMEOUT_MS = 4000;

function rpc(host, port, user, password, method, params = []) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ jsonrpc: '1.0', id: 'meowsolo-probe', method, params });
        const auth = (user || password) ? `${user || ''}:${password || ''}` : undefined;

        const req = http.request({
            hostname: host,
            port,
            method: 'POST',
            path: '/',
            auth,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: PROBE_TIMEOUT_MS,
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                if (res.statusCode === 401) {
                    return resolve({ ok: false, kind: 'auth', statusCode: 401 });
                }
                if (res.statusCode !== 200 && res.statusCode !== 500) {
                    return resolve({ ok: false, kind: 'http', statusCode: res.statusCode, body: data });
                }
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (err) {
                    return resolve({ ok: false, kind: 'parse', body: data });
                }
                if (parsed.error) {
                    return resolve({ ok: false, kind: 'rpc', error: parsed.error });
                }
                resolve({ ok: true, result: parsed.result });
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, kind: 'timeout' });
        });
        req.on('error', (err) => {
            resolve({ ok: false, kind: 'connect', code: err.code, message: err.message });
        });

        req.write(body);
        req.end();
    });
}

// `rpcInfo` shape: { host, port, user, password } (any can be missing).
// Returns { ok, networkInfo, blockchainInfo, consensus, network, friendlyError? }
async function probeNode(rpcInfo) {
    if (!rpcInfo || !rpcInfo.host || !rpcInfo.port) {
        return { ok: false, friendlyError: 'No RPC host/port provided.' };
    }

    const net = await rpc(rpcInfo.host, rpcInfo.port, rpcInfo.user, rpcInfo.password, 'getnetworkinfo');
    if (!net.ok) {
        return { ok: false, ...formatFriendly(net, rpcInfo) };
    }

    const chain = await rpc(rpcInfo.host, rpcInfo.port, rpcInfo.user, rpcInfo.password, 'getblockchaininfo');
    if (!chain.ok) {
        return { ok: false, ...formatFriendly(chain, rpcInfo) };
    }

    const subver = (net.result.subversion || '').toLowerCase();
    const versionInt = net.result.version || 0;
    // APEX upgrade activation is tagged in the daemon's subversion string.
    // Heuristic: subversion contains "apex", OR daemon protocol/version >= APEX threshold.
    // Pre-APEX Meowcoin Core is 3.0.6 (version int 3000600). APEX builds are 4.x+.
    let consensus;
    if (subver.includes('apex')) consensus = 'apex';
    else if (versionInt >= 4000000) consensus = 'apex';
    else if (versionInt > 0 && versionInt < 4000000) consensus = 'legacy';
    else consensus = 'apex'; // safe default for unknown new releases

    const chainName = (chain.result.chain || '').toLowerCase();
    let network = 'mainnet';
    if (chainName === 'test' || chainName === 'testnet' || chainName === 'testnet4') network = 'testnet';
    else if (chainName === 'regtest') network = 'regtest';

    return {
        ok: true,
        networkInfo: net.result,
        blockchainInfo: chain.result,
        consensus,
        network,
        chainName: chain.result.chain,
        height: chain.result.blocks,
        subversion: net.result.subversion,
        version: net.result.version,
    };
}

function formatFriendly(result, rpcInfo) {
    const { host, port } = rpcInfo;
    switch (result.kind) {
        case 'connect': {
            if (result.code === 'ECONNREFUSED') {
                return {
                    friendlyError: `Couldn't connect to Meowcoin Core at ${host}:${port}.`,
                    hint: `Is Meowcoin Core (meowcoin-qt or meowcoind) running? If you just started it, give it a few seconds. `
                        + `Also check that "server=1" is in your meowcoin.conf — without it, Core won't accept RPC connections.`,
                };
            }
            return {
                friendlyError: `Network error connecting to ${host}:${port}: ${result.message}`,
                hint: `Check the host/port in your config matches your meowcoin.conf rpcport (default ${port === 9766 ? '9766 mainnet' : '19766 testnet'}).`,
            };
        }
        case 'timeout':
            return {
                friendlyError: `Meowcoin Core at ${host}:${port} didn't respond in ${PROBE_TIMEOUT_MS}ms.`,
                hint: `The node might still be loading the chain index. Check the Meowcoin Core debug.log.`,
            };
        case 'auth':
            return {
                friendlyError: `Meowcoin Core rejected the RPC username/password (401).`,
                hint: `Either fix the rpcuser/rpcpassword in your meowcoin.conf or delete config.json and re-run the setup wizard. `
                    + `Note: editing meowcoin.conf requires restarting Meowcoin Core.`,
            };
        case 'rpc':
            return {
                friendlyError: `RPC call failed: ${result.error.message || JSON.stringify(result.error)}`,
                hint: `The daemon is reachable but returned an error. This usually means your node is still syncing.`,
            };
        case 'http':
            return {
                friendlyError: `Unexpected HTTP ${result.statusCode} from ${host}:${port}.`,
                hint: `Is this actually the Meowcoin Core RPC port? You may be pointed at the wrong service.`,
            };
        case 'parse':
            return {
                friendlyError: `Got an unparseable response from ${host}:${port}.`,
                hint: `Is this actually the Meowcoin Core RPC port? You may be pointed at the wrong service.`,
            };
        default:
            return { friendlyError: `RPC probe failed (${result.kind}).` };
    }
}

module.exports = {
    probeNode,
    rpc,
    PROBE_TIMEOUT_MS,
};
