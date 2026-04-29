'use strict';

const fs = require('fs');
const https = require('https');
const ExcelJS = require('exceljs');

// Meowcoin consensus constants (mirrors stratum_proxy.py)
const COIN = 100_000_000;
const SUBSIDY_HALVING_INTERVAL = 2_100_000;
const INITIAL_SUBSIDY_COINS = 5000;
const COMMUNITY_FUND_PCT = 40;

const HEADERS = [
    'Date/Time (UTC)',
    'Height',
    'Block Reward (MEWC)',
    'Fees (MEWC)',
    'Total (MEWC)',
    'MEWC/USDT Price',
    'Block Value (USD)',
    'USD→CAD Rate',
    'Block Value (CAD)',
    'Coinbase TxID',
    'Worker',
    'Nonce',
    'Cumulative Blocks',
    'Cumulative MEWC',
    'Cumulative USD',
    'Cumulative CAD',
];

// Per-block subsidy in satoshis. Halves every SUBSIDY_HALVING_INTERVAL blocks.
function getBlockSubsidy(height) {
    const halvings = Math.floor(height / SUBSIDY_HALVING_INTERVAL);
    if (halvings >= 64)
        return 0;
    return Math.floor((INITIAL_SUBSIDY_COINS * COIN) / Math.pow(2, halvings));
}

// Lightweight HTTPS GET → JSON, no external deps. Resolves null on failure.
function httpsGetJson(host, path, timeoutMs) {
    return new Promise(resolve => {
        const req = https.request({
            host: host,
            path: path,
            method: 'GET',
            timeout: timeoutMs,
            headers: { 'Content-Type': 'application/json' },
        }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (_) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end();
    });
}


class PriceFetcher {

    constructor() {
        this._priceUsd = null;
        this._priceAt = 0;
        this._cadRate = null;
        this._cadAt = 0;
        this._priceTtlMs = 60 * 1000;
        this._cadTtlMs = 3600 * 1000;
    }

    async getPriceUsd() {
        const now = Date.now();
        if (this._priceUsd !== null && (now - this._priceAt) < this._priceTtlMs)
            return this._priceUsd;

        const data = await httpsGetJson('api.nonkyc.io', '/api/v2/ticker/MEWC_USDT', 10000);
        const price = data && parseFloat(data.last_price);
        if (price && price > 0) {
            this._priceUsd = price;
            this._priceAt = now;
        }
        return this._priceUsd;
    }

    async getUsdToCad() {
        const now = Date.now();
        if (this._cadRate !== null && (now - this._cadAt) < this._cadTtlMs)
            return this._cadRate;

        const data = await httpsGetJson('open.er-api.com', '/v6/latest/USD', 10000);
        const rate = data && data.rates && parseFloat(data.rates.CAD);
        if (rate && rate > 0) {
            this._cadRate = rate;
            this._cadAt = now;
        }
        return this._cadRate;
    }
}


class BlockLogger {

    /**
     * @param args.filepath {string} Path to the xlsx file. Defaults to "block_finds.xlsx".
     * @param args.priceFetcher {PriceFetcher} Optional shared fetcher.
     */
    constructor(args) {
        args = args || {};
        this._filepath = args.filepath || 'block_finds.xlsx';
        this._priceFetcher = args.priceFetcher || new PriceFetcher();
        this._writeQueue = Promise.resolve();
    }

    /**
     * Append a row for an accepted block. Returns a promise that resolves once
     * the file is written. Calls are serialised so concurrent block events
     * cannot corrupt the file.
     *
     * @param args.height {number}
     * @param args.rewardSat {number}  Miner reward in satoshis (post-community-fund split).
     * @param args.feeSat {number}     Total tx fees in satoshis.
     * @param args.txidHex {string}    Coinbase TxID (display order).
     * @param args.worker {string}
     * @param args.nonceHex {string}
     */
    logBlock(args) {
        const _ = this;
        _._writeQueue = _._writeQueue.then(() => _._appendRow(args)).catch(err => {
            console.error('BlockLogger: failed to write row:', err);
        });
        return _._writeQueue;
    }

    async _appendRow(args) {
        const _ = this;

        const priceUsd = await _._priceFetcher.getPriceUsd();
        const cadRate = await _._priceFetcher.getUsdToCad();

        const rewardMewc = args.rewardSat / COIN;
        const feeMewc = (args.feeSat || 0) / COIN;
        const totalMewc = rewardMewc + feeMewc;
        const blockUsd = priceUsd ? totalMewc * priceUsd : null;
        const blockCad = (blockUsd && cadRate) ? blockUsd * cadRate : null;
        const nowUtc = new Date().toISOString().replace('T', ' ').slice(0, 19);

        const wb = new ExcelJS.Workbook();
        let ws;

        if (fs.existsSync(_._filepath)) {
            try {
                await wb.xlsx.readFile(_._filepath);
                ws = wb.getWorksheet('Block Finds') || wb.worksheets[0];
                if (!ws) {
                    ws = wb.addWorksheet('Block Finds');
                    ws.addRow(HEADERS);
                    ws.getRow(1).font = { bold: true };
                }
            }
            catch (loadErr) {
                console.warn(`BlockLogger: could not load ${_._filepath} (${loadErr.message}) — recreating`);
                ws = wb.addWorksheet('Block Finds');
                ws.addRow(HEADERS);
                ws.getRow(1).font = { bold: true };
            }
        }
        else {
            ws = wb.addWorksheet('Block Finds');
            ws.addRow(HEADERS);
            ws.getRow(1).font = { bold: true };
        }

        // Cumulative totals over existing rows + this new one
        let cumMewc = totalMewc;
        let cumUsd = blockUsd || 0;
        let cumCad = blockCad || 0;
        const cumBlocks = ws.rowCount; // header is row 1, so existing data rows = rowCount-1, +1 new = rowCount
        for (let r = 2; r <= ws.rowCount; r++) {
            const row = ws.getRow(r);
            const totVal = row.getCell(5).value;
            const usdVal = row.getCell(7).value;
            const cadVal = row.getCell(9).value;
            if (typeof totVal === 'number') cumMewc += totVal;
            if (typeof usdVal === 'number') cumUsd += usdVal;
            if (typeof cadVal === 'number') cumCad += cadVal;
        }

        const newRow = ws.addRow([
            nowUtc,
            args.height,
            rewardMewc,
            feeMewc,
            totalMewc,
            priceUsd,
            blockUsd != null ? Number(blockUsd.toFixed(4)) : null,
            cadRate != null ? Number(cadRate.toFixed(4)) : null,
            blockCad != null ? Number(blockCad.toFixed(4)) : null,
            args.txidHex,
            args.worker,
            args.nonceHex,
            cumBlocks,
            Number(cumMewc.toFixed(8)),
            Number(cumUsd.toFixed(4)),
            Number(cumCad.toFixed(4)),
        ]);

        // Number formats — match the proxy's xlsx
        newRow.getCell(3).numFmt = '#,##0.00000000';
        newRow.getCell(4).numFmt = '#,##0.00000000';
        newRow.getCell(5).numFmt = '#,##0.00000000';
        newRow.getCell(6).numFmt = '$#,##0.00000000';
        newRow.getCell(7).numFmt = '$#,##0.0000';
        newRow.getCell(8).numFmt = '#,##0.0000';
        newRow.getCell(9).numFmt = 'C$#,##0.0000';
        newRow.getCell(14).numFmt = '#,##0.00000000';
        newRow.getCell(15).numFmt = '$#,##0.0000';
        newRow.getCell(16).numFmt = 'C$#,##0.0000';

        await wb.xlsx.writeFile(_._filepath);

        console.log(
            `Block logged to ${_._filepath}: height=${args.height}, ` +
            `reward=${totalMewc.toFixed(2)} MEWC, ` +
            `price=$${(priceUsd || 0).toFixed(6)}, ` +
            `value=$${(blockUsd || 0).toFixed(4)} / C$${(blockCad || 0).toFixed(4)}`
        );
    }
}


module.exports = BlockLogger;
module.exports.BlockLogger = BlockLogger;
module.exports.PriceFetcher = PriceFetcher;
module.exports.getBlockSubsidy = getBlockSubsidy;
module.exports.COIN = COIN;
module.exports.COMMUNITY_FUND_PCT = COMMUNITY_FUND_PCT;
