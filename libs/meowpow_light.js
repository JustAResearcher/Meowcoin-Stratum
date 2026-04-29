'use strict';
/**
 * MeowPow light-verify: compute the final block hash from header_hash + nonce + mix_hash
 * without needing the DAG. Uses two rounds of Keccak-f[800] with MeowPow coin constants.
 *
 * This is a direct port of meowpow::hash_no_verify() from
 * src/crypto/ethash/lib/ethash/meowpow.cpp
 */

const crypto = require('crypto');

// Keccak-f[800] round constants (22 rounds for w=32)
const ROUND_CONSTANTS = new Uint32Array([
    0x00000001, 0x00008082, 0x0000808A, 0x80008000,
    0x0000808B, 0x80000001, 0x80008081, 0x00008009,
    0x0000008A, 0x00000088, 0x80008009, 0x8000000A,
    0x8000808B, 0x0000008B, 0x00008089, 0x00008003,
    0x00008002, 0x00000080, 0x0000800A, 0x8000000A,
    0x80008081, 0x00008080,
]);

// MeowCoin constants: ASCII "MEOWCOINMEOWPOW" as uint32 words
const MEOWCOIN_MEOWPOW = new Uint32Array([
    0x0000004D, // M
    0x00000045, // E
    0x0000004F, // O
    0x00000057, // W
    0x00000043, // C
    0x0000004F, // O
    0x00000049, // I
    0x0000004E, // N
    0x0000004D, // M
    0x00000045, // E
    0x0000004F, // O
    0x00000057, // W
    0x00000050, // P
    0x0000004F, // O
    0x00000057, // W
]);


/**
 * 32-bit rotate left
 */
function rol(x, s) {
    return ((x << s) | (x >>> (32 - s))) >>> 0;
}


/**
 * Keccak-f[800] permutation on 25 x uint32 state.
 * Direct translation from keccakf800.c
 */
function keccakf800(state) {
    let Aba = state[0],  Abe = state[1],  Abi = state[2],  Abo = state[3],  Abu = state[4];
    let Aga = state[5],  Age = state[6],  Agi = state[7],  Ago = state[8],  Agu = state[9];
    let Aka = state[10], Ake = state[11], Aki = state[12], Ako = state[13], Aku = state[14];
    let Ama = state[15], Ame = state[16], Ami = state[17], Amo = state[18], Amu = state[19];
    let Asa = state[20], Ase = state[21], Asi = state[22], Aso = state[23], Asu = state[24];

    let Eba, Ebe, Ebi, Ebo, Ebu;
    let Ega, Ege, Egi, Ego, Egu;
    let Eka, Eke, Eki, Eko, Eku;
    let Ema, Eme, Emi, Emo, Emu;
    let Esa, Ese, Esi, Eso, Esu;
    let Ba, Be, Bi, Bo, Bu;
    let Da, De, Di, Do, Du;

    for (let round = 0; round < 22; round += 2) {
        // Round (round + 0): Axx -> Exx
        Ba = (Aba ^ Aga ^ Aka ^ Ama ^ Asa) >>> 0;
        Be = (Abe ^ Age ^ Ake ^ Ame ^ Ase) >>> 0;
        Bi = (Abi ^ Agi ^ Aki ^ Ami ^ Asi) >>> 0;
        Bo = (Abo ^ Ago ^ Ako ^ Amo ^ Aso) >>> 0;
        Bu = (Abu ^ Agu ^ Aku ^ Amu ^ Asu) >>> 0;

        Da = (Bu ^ rol(Be, 1)) >>> 0;
        De = (Ba ^ rol(Bi, 1)) >>> 0;
        Di = (Be ^ rol(Bo, 1)) >>> 0;
        Do = (Bi ^ rol(Bu, 1)) >>> 0;
        Du = (Bo ^ rol(Ba, 1)) >>> 0;

        Ba = (Aba ^ Da) >>> 0;
        Be = rol((Age ^ De) >>> 0, 12);
        Bi = rol((Aki ^ Di) >>> 0, 11);
        Bo = rol((Amo ^ Do) >>> 0, 21);
        Bu = rol((Asu ^ Du) >>> 0, 14);
        Eba = (Ba ^ (~Be & Bi) ^ ROUND_CONSTANTS[round]) >>> 0;
        Ebe = (Be ^ (~Bi & Bo)) >>> 0;
        Ebi = (Bi ^ (~Bo & Bu)) >>> 0;
        Ebo = (Bo ^ (~Bu & Ba)) >>> 0;
        Ebu = (Bu ^ (~Ba & Be)) >>> 0;

        Ba = rol((Abo ^ Do) >>> 0, 28);
        Be = rol((Agu ^ Du) >>> 0, 20);
        Bi = rol((Aka ^ Da) >>> 0, 3);
        Bo = rol((Ame ^ De) >>> 0, 13);
        Bu = rol((Asi ^ Di) >>> 0, 29);
        Ega = (Ba ^ (~Be & Bi)) >>> 0;
        Ege = (Be ^ (~Bi & Bo)) >>> 0;
        Egi = (Bi ^ (~Bo & Bu)) >>> 0;
        Ego = (Bo ^ (~Bu & Ba)) >>> 0;
        Egu = (Bu ^ (~Ba & Be)) >>> 0;

        Ba = rol((Abe ^ De) >>> 0, 1);
        Be = rol((Agi ^ Di) >>> 0, 6);
        Bi = rol((Ako ^ Do) >>> 0, 25);
        Bo = rol((Amu ^ Du) >>> 0, 8);
        Bu = rol((Asa ^ Da) >>> 0, 18);
        Eka = (Ba ^ (~Be & Bi)) >>> 0;
        Eke = (Be ^ (~Bi & Bo)) >>> 0;
        Eki = (Bi ^ (~Bo & Bu)) >>> 0;
        Eko = (Bo ^ (~Bu & Ba)) >>> 0;
        Eku = (Bu ^ (~Ba & Be)) >>> 0;

        Ba = rol((Abu ^ Du) >>> 0, 27);
        Be = rol((Aga ^ Da) >>> 0, 4);
        Bi = rol((Ake ^ De) >>> 0, 10);
        Bo = rol((Ami ^ Di) >>> 0, 15);
        Bu = rol((Aso ^ Do) >>> 0, 24);
        Ema = (Ba ^ (~Be & Bi)) >>> 0;
        Eme = (Be ^ (~Bi & Bo)) >>> 0;
        Emi = (Bi ^ (~Bo & Bu)) >>> 0;
        Emo = (Bo ^ (~Bu & Ba)) >>> 0;
        Emu = (Bu ^ (~Ba & Be)) >>> 0;

        Ba = rol((Abi ^ Di) >>> 0, 30);
        Be = rol((Ago ^ Do) >>> 0, 23);
        Bi = rol((Aku ^ Du) >>> 0, 7);
        Bo = rol((Ama ^ Da) >>> 0, 9);
        Bu = rol((Ase ^ De) >>> 0, 2);
        Esa = (Ba ^ (~Be & Bi)) >>> 0;
        Ese = (Be ^ (~Bi & Bo)) >>> 0;
        Esi = (Bi ^ (~Bo & Bu)) >>> 0;
        Eso = (Bo ^ (~Bu & Ba)) >>> 0;
        Esu = (Bu ^ (~Ba & Be)) >>> 0;

        // Round (round + 1): Exx -> Axx
        Ba = (Eba ^ Ega ^ Eka ^ Ema ^ Esa) >>> 0;
        Be = (Ebe ^ Ege ^ Eke ^ Eme ^ Ese) >>> 0;
        Bi = (Ebi ^ Egi ^ Eki ^ Emi ^ Esi) >>> 0;
        Bo = (Ebo ^ Ego ^ Eko ^ Emo ^ Eso) >>> 0;
        Bu = (Ebu ^ Egu ^ Eku ^ Emu ^ Esu) >>> 0;

        Da = (Bu ^ rol(Be, 1)) >>> 0;
        De = (Ba ^ rol(Bi, 1)) >>> 0;
        Di = (Be ^ rol(Bo, 1)) >>> 0;
        Do = (Bi ^ rol(Bu, 1)) >>> 0;
        Du = (Bo ^ rol(Ba, 1)) >>> 0;

        Ba = (Eba ^ Da) >>> 0;
        Be = rol((Ege ^ De) >>> 0, 12);
        Bi = rol((Eki ^ Di) >>> 0, 11);
        Bo = rol((Emo ^ Do) >>> 0, 21);
        Bu = rol((Esu ^ Du) >>> 0, 14);
        Aba = (Ba ^ (~Be & Bi) ^ ROUND_CONSTANTS[round + 1]) >>> 0;
        Abe = (Be ^ (~Bi & Bo)) >>> 0;
        Abi = (Bi ^ (~Bo & Bu)) >>> 0;
        Abo = (Bo ^ (~Bu & Ba)) >>> 0;
        Abu = (Bu ^ (~Ba & Be)) >>> 0;

        Ba = rol((Ebo ^ Do) >>> 0, 28);
        Be = rol((Egu ^ Du) >>> 0, 20);
        Bi = rol((Eka ^ Da) >>> 0, 3);
        Bo = rol((Eme ^ De) >>> 0, 13);
        Bu = rol((Esi ^ Di) >>> 0, 29);
        Aga = (Ba ^ (~Be & Bi)) >>> 0;
        Age = (Be ^ (~Bi & Bo)) >>> 0;
        Agi = (Bi ^ (~Bo & Bu)) >>> 0;
        Ago = (Bo ^ (~Bu & Ba)) >>> 0;
        Agu = (Bu ^ (~Ba & Be)) >>> 0;

        Ba = rol((Ebe ^ De) >>> 0, 1);
        Be = rol((Egi ^ Di) >>> 0, 6);
        Bi = rol((Eko ^ Do) >>> 0, 25);
        Bo = rol((Emu ^ Du) >>> 0, 8);
        Bu = rol((Esa ^ Da) >>> 0, 18);
        Aka = (Ba ^ (~Be & Bi)) >>> 0;
        Ake = (Be ^ (~Bi & Bo)) >>> 0;
        Aki = (Bi ^ (~Bo & Bu)) >>> 0;
        Ako = (Bo ^ (~Bu & Ba)) >>> 0;
        Aku = (Bu ^ (~Ba & Be)) >>> 0;

        Ba = rol((Ebu ^ Du) >>> 0, 27);
        Be = rol((Ega ^ Da) >>> 0, 4);
        Bi = rol((Eke ^ De) >>> 0, 10);
        Bo = rol((Emi ^ Di) >>> 0, 15);
        Bu = rol((Eso ^ Do) >>> 0, 24);
        Ama = (Ba ^ (~Be & Bi)) >>> 0;
        Ame = (Be ^ (~Bi & Bo)) >>> 0;
        Ami = (Bi ^ (~Bo & Bu)) >>> 0;
        Amo = (Bo ^ (~Bu & Ba)) >>> 0;
        Amu = (Bu ^ (~Ba & Be)) >>> 0;

        Ba = rol((Ebi ^ Di) >>> 0, 30);
        Be = rol((Ego ^ Do) >>> 0, 23);
        Bi = rol((Eku ^ Du) >>> 0, 7);
        Bo = rol((Ema ^ Da) >>> 0, 9);
        Bu = rol((Ese ^ De) >>> 0, 2);
        Asa = (Ba ^ (~Be & Bi)) >>> 0;
        Ase = (Be ^ (~Bi & Bo)) >>> 0;
        Asi = (Bi ^ (~Bo & Bu)) >>> 0;
        Aso = (Bo ^ (~Bu & Ba)) >>> 0;
        Asu = (Bu ^ (~Ba & Be)) >>> 0;
    }

    state[0] = Aba; state[1] = Abe; state[2] = Abi; state[3] = Abo; state[4] = Abu;
    state[5] = Aga; state[6] = Age; state[7] = Agi; state[8] = Ago; state[9] = Agu;
    state[10] = Aka; state[11] = Ake; state[12] = Aki; state[13] = Ako; state[14] = Aku;
    state[15] = Ama; state[16] = Ame; state[17] = Ami; state[18] = Amo; state[19] = Amu;
    state[20] = Asa; state[21] = Ase; state[22] = Asi; state[23] = Aso; state[24] = Asu;
}


/**
 * Double SHA-256 of a buffer (Bitcoin's standard hash)
 * @param {Buffer} data
 * @returns {Buffer} 32 bytes in standard order (MSB first)
 */
function sha256d(data) {
    const h1 = crypto.createHash('sha256').update(data).digest();
    return crypto.createHash('sha256').update(h1).digest();
}


/**
 * Compute MeowPow light-verify final hash.
 *
 * This corresponds to meowpow::hash_no_verify() in meowpow.cpp.
 *
 * @param {Buffer} headerHashBuf  - SHA256d of 80-byte header, 32 bytes, standard byte order
 *                                  (MSB at index 0, matching to_hash256(GetHex()) in C++)
 * @param {Buffer} nonceBuf       - 8-byte nonce in little-endian byte order
 * @param {Buffer} mixHashBuf     - 32-byte mix_hash in standard byte order (MSB at index 0)
 *                                  This is the display/GetHex() order, NOT the uint256 LE internal.
 * @returns {Buffer} 32-byte final hash in standard order (MSB at index 0).
 *                   This is the "block hash" that must be below the target for valid PoW.
 */
function meowpowLightVerify(headerHashBuf, nonceBuf, mixHashBuf) {
    // Round 1: Keccak-f[800]
    const state1 = new Uint32Array(25);

    // Words 0-7: header_hash as uint32 LE words from standard-order bytes
    // C++ does: state[i] = header_hash.word32s[i]
    // hash256.word32s on LE = readUInt32LE on the bytes array (bytes[0]=MSB)
    for (let i = 0; i < 8; i++) {
        state1[i] = headerHashBuf.readUInt32LE(i * 4);
    }

    // Words 8-9: nonce as two uint32 (low, high)
    state1[8] = nonceBuf.readUInt32LE(0);
    state1[9] = nonceBuf.readUInt32LE(4);

    // Words 10-24: MeowCoin constants
    for (let i = 10; i < 25; i++) {
        state1[i] = MEOWCOIN_MEOWPOW[i - 10];
    }

    keccakf800(state1);

    // Round 2: Keccak-f[800]
    const state2 = new Uint32Array(25);

    // Words 0-7: carry-over from round 1
    for (let i = 0; i < 8; i++) {
        state2[i] = state1[i];
    }

    // Words 8-15: mix_hash as uint32 LE words from standard-order bytes
    for (let i = 0; i < 8; i++) {
        state2[8 + i] = mixHashBuf.readUInt32LE(i * 4);
    }

    // Words 16-24: first 9 MeowCoin constants
    for (let i = 16; i < 25; i++) {
        state2[i] = MEOWCOIN_MEOWPOW[i - 16];
    }

    keccakf800(state2);

    // Output: state[0..7] as LE uint32 words → bytes
    // C++ does: output.word32s[i] = le::uint32(state[i]) (identity on LE)
    // Then: uint256 output = IsLE() ? uint256(result) : bswap(...)
    // On LE: direct copy of hash256 bytes → uint256 data
    const output = Buffer.alloc(32);
    for (let i = 0; i < 8; i++) {
        output.writeUInt32LE(state2[i], i * 4);
    }

    return output;
}


/**
 * Compute the full MeowPow block hash from the 80-byte header and PoW solution.
 *
 * @param {Buffer} header80 - 80-byte MeowPoW header (version+prev+merkle+time+bits+height)
 * @param {Buffer} nonceBuf - 8-byte nonce LE
 * @param {Buffer} mixHashBuf - 32-byte mix_hash in standard order (MSB first)
 * @returns {Buffer} 32-byte block hash in standard order (for display: MSB first)
 */
function computeBlockHash(header80, nonceBuf, mixHashBuf) {
    const headerHash = sha256d(header80);
    return meowpowLightVerify(headerHash, nonceBuf, mixHashBuf);
}


/**
 * Parse target from nBits (compact representation).
 *
 * @param {number} nBits - compact target representation from block template
 * @returns {Buffer} 32-byte target in standard order (MSB first)
 */
function targetFromBits(nBits) {
    const exponent = (nBits >>> 24) & 0xFF;
    const mantissa = nBits & 0x007FFFFF;
    const isNegative = (nBits & 0x00800000) !== 0;

    const target = Buffer.alloc(32, 0);

    if (exponent <= 3) {
        // Mantissa fits in bytes at positions 32-exponent to 32-1
        const shift = 8 * (3 - exponent);
        const val = mantissa >>> shift;
        if (val > 0) {
            target[32 - 1] = val & 0xFF;
            if (exponent >= 2) target[32 - 2] = (val >>> 8) & 0xFF;
            if (exponent >= 3) target[32 - 3] = (val >>> 16) & 0xFF;
        }
    } else {
        // Place 3 mantissa bytes starting at position (32 - exponent)
        const startByte = 32 - exponent;
        target[startByte] = (mantissa >>> 16) & 0xFF;
        target[startByte + 1] = (mantissa >>> 8) & 0xFF;
        target[startByte + 2] = mantissa & 0xFF;
    }

    if (isNegative) {
        // Negate (not expected in valid blocks, but handle for correctness)
        for (let i = 0; i < 32; i++) target[i] = ~target[i] & 0xFF;
        // Add 1
        let carry = 1;
        for (let i = 31; i >= 0 && carry; i--) {
            const sum = target[i] + carry;
            target[i] = sum & 0xFF;
            carry = sum >>> 8;
        }
    }

    return target;
}


/**
 * Compare two 32-byte buffers as big-endian 256-bit unsigned integers.
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
 */
function compare256(a, b) {
    for (let i = 0; i < 32; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
    }
    return 0;
}


/**
 * Check if a block's PoW hash meets the network target.
 *
 * @param {Buffer} header80 - 80-byte header
 * @param {Buffer} nonceBuf - 8-byte nonce LE
 * @param {Buffer} mixHashBuf - 32-byte mix_hash in standard order (MSB first, as from miner)
 * @param {number} nBits - compact target from block template
 * @returns {{meetsTarget: boolean, blockHash: Buffer, target: Buffer}}
 */
function checkBlockPoW(header80, nonceBuf, mixHashBuf, nBits) {
    const blockHash = computeBlockHash(header80, nonceBuf, mixHashBuf);
    // blockHash bytes[0] = MSB (same as hash256.bytes layout used in to_hex())
    // This matches the display order shown in getblock/getblockhash RPCs
    const target = targetFromBits(nBits);
    const meetsTarget = compare256(blockHash, target) <= 0;

    return { meetsTarget, blockHash, target };
}


module.exports = {
    keccakf800,
    sha256d,
    meowpowLightVerify,
    computeBlockHash,
    targetFromBits,
    compare256,
    checkBlockPoW,
};
