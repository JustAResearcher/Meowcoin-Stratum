'use strict';

const
    scripts = require('@mintpond/mint-bitcoin-script'),
    precon = require('@mintpond/mint-precon'),
    mu = require('@mintpond/mint-utils'),
    buffers = require('@mintpond/mint-utils').buffers,
    Client = require('./class.Client'),
    Share = require('./class.Share');

const
    EXTRANONCE_SIZE = 8,
    BUFFER_U32_ZERO = buffers.packUInt32LE(0),
    BUFFER_VAR_ONE = buffers.packVarInt(1),
    BUFFER_32_MAX = Buffer.from('FFFFFFFF', 'hex'),
    BUFFER_TX_VERSION_2 = buffers.packUInt32LE(2),
    BUFFER_INPUT_HASH = buffers.packUInt256LE(0),
    // SegWit coinbase constants
    BUFFER_SEGWIT_MARKER_FLAG = Buffer.from([0x00, 0x01]),
    // Coinbase witness: 1 stack item, 32 bytes, all zeros (standard witness nonce)
    BUFFER_COINBASE_WITNESS = Buffer.concat([
        Buffer.from([0x01, 0x20]),  // 1 item, 32 bytes
        Buffer.alloc(32)            // 32 zero bytes
    ]),
    // Base block subsidy: 5000 MEWC = 500000000000 satoshis (no halving in Meowcoin)
    BASE_SUBSIDY_ST = 500000000000;


class Coinbase {

    /**
     * Constructor.
     *
     * @param args
     * @param args.coinbaseAddress {string}
     * @param args.blockTemplate {object}
     * @param [args.blockBrand] {string}
     */
    constructor(args) {
        precon.string(args.coinbaseAddress, 'coinbaseAddress');
        precon.notNull(args.blockTemplate, 'blockTemplate');
        precon.opt_string(args.blockBrand, 'blockBrand');
        precon.opt_string(args.devAddress, 'devAddress');

        const _ = this;
        _._coinbaseAddress = args.coinbaseAddress;
        _._blockTemplate = args.blockTemplate;
        _._blockBrand = args.blockBrand || '/@mintpond/ref-stratum/'
        _._devAddress = args.devAddress || null;
        _._devRewardPercent = args.devRewardPercent || 0;

        _._coinbase1 = null;
        _._coinbase2 = null;
        _._outputCount = 0;
        _._time = mu.now();

        _._blockBrandBuf = scripts.serializeString(_._blockBrand)
    }


    /**
     * Get the first part of the serialized coinbase.
     * @returns {Buffer}
     */
    get coinbase1Buf() { return this._coinbase1 || (this._coinbase1 = this._createCoinbase1()); }

    /**
     * Get the seconds part of the serialized coinbase.
     * @returns {Buffer}
     */
    get coinbase2Buf() { return this._coinbase2 || (this._coinbase2 = this._createCoinbase2()); }


    /**
     * Use information from a client to serialize coinbase in LEGACY format (for txid/merkle root).
     *
     * @param client {Client}
     * @returns {Buffer}
     */
    serialize(client) {
        precon.notNull(client, 'client');

        const _ = this;
        const coinbase1Buf = _.coinbase1Buf;
        const coinbase2Buf = _.coinbase2Buf;
        return Buffer.concat([
            coinbase1Buf,
            Buffer.from(client.extraNonce1Hex),
            coinbase2Buf
        ]);
    }


    /**
     * Use information from a client to serialize coinbase in SEGWIT format (for block data).
     * Inserts SegWit marker+flag after version and witness data before locktime.
     *
     * @param client {Client}
     * @returns {Buffer}
     */
    serializeWitness(client) {
        precon.notNull(client, 'client');

        const _ = this;
        const legacy = _.serialize(client);

        // Legacy format: [version(4)] [vin...vout...] [locktime(4)]
        // SegWit format: [version(4)] [marker(1) flag(1)] [vin...vout...] [witness] [locktime(4)]
        const version = legacy.slice(0, 4);
        const body = legacy.slice(4, legacy.length - 4);
        const locktime = legacy.slice(legacy.length - 4);

        return Buffer.concat([
            version,
            BUFFER_SEGWIT_MARKER_FLAG,
            body,
            BUFFER_COINBASE_WITNESS,
            locktime
        ]);
    }


    _createCoinbase1() {

        const _ = this;
        const inputScript = Buffer.concat([
            /* block height      */ scripts.serializeNumber(_._blockTemplate.height),
            /* time              */ scripts.serializeNumber(_._time),
            /* extranonce length */ Buffer.from([EXTRANONCE_SIZE])
        ]);

        const inputScriptLen = inputScript.length + EXTRANONCE_SIZE + _._blockBrandBuf.length;

        // First part of coinbase which is split at the extra nonce values
        return Buffer.concat([

            /* version       */ BUFFER_TX_VERSION_2,

            // Tx Inputs
            /* input count   */ BUFFER_VAR_ONE,
            /* input tx hash */ BUFFER_INPUT_HASH,
            /* input vout    */ BUFFER_32_MAX,
            /* input scr len */ buffers.packVarInt(inputScriptLen),
            /* input scr     */ inputScript
            // ...
        ]);
    }


    _createCoinbase2() {
        const _ = this;
        const outputsBuf = _._createOutputsBuf();

        // Second part of coinbase which is split at the extra nonce values
        return Buffer.concat([

            // ...
            /* block branding */ _._blockBrandBuf,
            /* input sequence */ BUFFER_32_MAX,

            // Tx Outputs
            /* output count   */ buffers.packVarInt(_._outputCount),
            /* outputs        */ outputsBuf,

            /* lock time      */ BUFFER_U32_ZERO
        ]);
    }


    _createOutputsBuf() {

        const _ = this;
        const outputsArr = [];
        const blockTemplate = _._blockTemplate;
        const poolAddressScript = scripts.makeAddressScript(_._coinbaseAddress);

        let totalReward = blockTemplate.coinbasevalue;

        _._outputCount = 0;

        // Dev fund split: flat 2000 MEWC to dev, 3000 MEWC + all fees to miner
        const devAddress = _._devAddress;
        const devRewardPercent = _._devRewardPercent;

        if (devAddress && devRewardPercent > 0) {
            const devAddressScript = scripts.makeAddressScript(devAddress);
            // Dev gets a flat percentage of the BASE subsidy only (not fees)
            const devRewardSt = Math.floor(BASE_SUBSIDY_ST * devRewardPercent / 100);
            const minerRewardSt = totalReward - devRewardSt;
            _._addOutput(outputsArr, minerRewardSt, poolAddressScript, true);
            _._addOutput(outputsArr, devRewardSt, devAddressScript, true);
        }
        else {
            _._addOutput(outputsArr, totalReward, poolAddressScript, true);
        }

        const default_witness_commitment = blockTemplate.default_witness_commitment;
        if (default_witness_commitment) {

            const witnessCommitmentBuf = Buffer.from(default_witness_commitment, 'hex');

            _._addOutput(outputsArr, 0, witnessCommitmentBuf);
        }

        return Buffer.concat(outputsArr);
    }


    _addOutput(outputBufArr, rewardSt, scriptBuff) {
        const _ = this;
        outputBufArr.push(
            buffers.packUInt64LE(rewardSt),
            buffers.packVarInt(scriptBuff.length),
            scriptBuff
        );
        _._outputCount++;
    }
}

module.exports = Coinbase;