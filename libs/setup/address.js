'use strict';

// Meowcoin uses Ravencoin-style base58check addresses.
// Mainnet pubkeyhash version byte: 0x32 (50) → 'M' prefix
// Mainnet scripthash version byte: 0x7a (122) → 'r' prefix (multisig — rare for solo payout)
// Testnet pubkeyhash version byte: 0x6f (111) → 'm' or 'n' prefix
//
// We validate base58 decoding + double-SHA256 checksum, then check the prefix
// against the requested network. Wrong-network payouts silently lose funds,
// so this check matters.

const crypto = require('crypto');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = (() => {
    const m = new Map();
    for (let i = 0; i < ALPHABET.length; i++) m.set(ALPHABET[i], i);
    return m;
})();

const MAINNET_PUBKEYHASH = 0x32;
const MAINNET_SCRIPTHASH = 0x7a;
// Meowcoin testnet4 uses 0x6d, not the Ravencoin/Bitcoin 0x6f. Accept both.
const TESTNET_PUBKEYHASH_VALUES = [0x6d, 0x6f];
const TESTNET_SCRIPTHASH = 0xc4;

function base58Decode(str) {
    if (typeof str !== 'string' || str.length === 0) return null;

    let num = [0];
    for (const ch of str) {
        const v = ALPHABET_MAP.get(ch);
        if (v === undefined) return null;
        let carry = v;
        for (let i = 0; i < num.length; i++) {
            const x = num[i] * 58 + carry;
            num[i] = x & 0xff;
            carry = x >>> 8;
        }
        while (carry) {
            num.push(carry & 0xff);
            carry >>>= 8;
        }
    }

    // Leading '1's in base58 → leading 0x00 bytes.
    let leadingZeros = 0;
    for (const ch of str) {
        if (ch === '1') leadingZeros++;
        else break;
    }

    const bytes = new Uint8Array(leadingZeros + num.length);
    for (let i = 0; i < num.length; i++) bytes[leadingZeros + i] = num[num.length - 1 - i];
    return Buffer.from(bytes);
}

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest();
}

// Returns { valid, version, kind } or { valid: false, reason }
function decodeAddress(addr) {
    if (!addr || typeof addr !== 'string')
        return { valid: false, reason: 'empty' };

    const trimmed = addr.trim();
    if (trimmed.length < 26 || trimmed.length > 40)
        return { valid: false, reason: 'wrong length (expected 26-40 chars, got ' + trimmed.length + ')' };

    const raw = base58Decode(trimmed);
    if (!raw)
        return { valid: false, reason: 'not valid base58 (contains characters outside the base58 alphabet)' };
    if (raw.length !== 25)
        return { valid: false, reason: 'wrong decoded length (expected 25 bytes, got ' + raw.length + ')' };

    const payload = raw.slice(0, 21);
    const checksum = raw.slice(21);
    const expected = sha256(sha256(payload)).slice(0, 4);
    if (!checksum.equals(expected))
        return { valid: false, reason: 'checksum mismatch (the address is corrupted or mistyped)' };

    const version = payload[0];
    let kind = null, network = null;
    if (version === MAINNET_PUBKEYHASH) { kind = 'p2pkh'; network = 'mainnet'; }
    else if (version === MAINNET_SCRIPTHASH) { kind = 'p2sh'; network = 'mainnet'; }
    else if (TESTNET_PUBKEYHASH_VALUES.includes(version)) { kind = 'p2pkh'; network = 'testnet'; }
    else if (version === TESTNET_SCRIPTHASH) { kind = 'p2sh'; network = 'testnet'; }
    else return { valid: false, reason: 'unknown version byte 0x' + version.toString(16) + ' — not a Meowcoin address (mainnet starts with M, testnet with k/m/n)' };

    return { valid: true, version, kind, network };
}

// Top-level validator used by the wizard. `expectedNetwork` is 'mainnet' or 'testnet'.
function validateCoinbaseAddress(addr, expectedNetwork) {
    const result = decodeAddress(addr);
    if (!result.valid) return { ok: false, message: result.reason };

    if (expectedNetwork && result.network !== expectedNetwork) {
        return {
            ok: false,
            message: `address is a ${result.network} address but you're mining ${expectedNetwork}. `
                + `Payouts to a ${result.network} address on the ${expectedNetwork} chain are unrecoverable. `
                + `Use a Meowcoin Core ${expectedNetwork} wallet to generate the right address.`,
        };
    }

    if (result.kind === 'p2sh') {
        return {
            ok: true,
            warning: 'p2sh address (multisig/script). Solo payouts to p2sh work but most miners use a plain p2pkh address (M-prefix).',
            network: result.network,
            kind: result.kind,
        };
    }

    return { ok: true, network: result.network, kind: result.kind };
}

module.exports = {
    base58Decode,
    decodeAddress,
    validateCoinbaseAddress,
    MAINNET_PUBKEYHASH,
    MAINNET_SCRIPTHASH,
    TESTNET_PUBKEYHASH_VALUES,
    TESTNET_SCRIPTHASH,
};
