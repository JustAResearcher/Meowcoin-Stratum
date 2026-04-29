'use strict';

// Catch all unhandled errors so the process doesn't die silently
process.on('uncaughtException', err => {
    console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

const Stratum = require('./libs/class.Stratum');
const { BlockLogger, getBlockSubsidy, COMMUNITY_FUND_PCT } = require('./libs/class.BlockLogger');
const config = require('./config.json');

const stratum = new Stratum(config);
const blockLogger = new BlockLogger({ filepath: config.blockLogFile || 'block_finds.xlsx' });

stratum.init();

stratum.on(Stratum.EVENT_CLIENT_CONNECT, ev => {
    console.log(`Client connected: ${ev.client.socket.remoteAddress}`);
});

stratum.on(Stratum.EVENT_CLIENT_SUBSCRIBE, ev => {
    console.log(`Client subscribed: ${ev.client.socket.remoteAddress}`);
});

stratum.on(Stratum.EVENT_CLIENT_AUTHORIZE, ev => {
    console.log(`Client authorized: ${ev.client.workerName}`);
});

stratum.on(Stratum.EVENT_CLIENT_DISCONNECT, ev => {
    console.log(`Client disconnected: ${ev.client.socket.remoteAddress} ${ev.reason}`);
});

stratum.on(Stratum.EVENT_CLIENT_SOCKET_ERROR, ev => {
    console.error(`Client socket error:`, ev);
});

stratum.on(Stratum.EVENT_CLIENT_MALFORMED_MESSAGE, ev => {
    console.error(`Client malformed message:`, ev);
});

stratum.on(Stratum.EVENT_CLIENT_UNKNOWN_STRATUM_METHOD, ev => {
    console.error(`Client unknown stratum method:`, ev);
});

stratum.on(Stratum.EVENT_CLIENT_TIMEOUT, ev => {
    console.log(`Client timeout: ${ev.client.socket.remoteAddress}`);
});

stratum.on(Stratum.EVENT_SHARE_SUBMITTED, ev => {
    if (ev.share.isValidBlock) {
        console.log(`Valid block submitted by ${ev.share.client.workerName}`)

        const subsidy = getBlockSubsidy(ev.share.jobHeight);
        const communityShare = Math.floor((subsidy * COMMUNITY_FUND_PCT) / 100);
        const minerReward = subsidy - communityShare;

        blockLogger.logBlock({
            height: ev.share.jobHeight,
            rewardSat: minerReward,
            feeSat: 0,
            txidHex: ev.share.blockTxId || '',
            worker: ev.share.client.workerName,
            nonceHex: ev.share.nonceHex,
        });
    }
    else if (ev.share.isValidShare) {
        console.log(`Valid share submitted by ${ev.share.client.workerName}`)
    }
    else {
        console.log(`Invalid share submitted by ${ev.share.client.workerName} ${ev.share.error.message}`)
    }
});

stratum.on(Stratum.EVENT_NEXT_JOB, ev => {
    console.log(`New job: ${ev.job.idHex} height=${ev.job.height} newBlock=${ev.isNewBlock}`);
});

// Make sure Error can be JSON serialized
if (!Error.prototype.toJSON) {
    Error.prototype.toJSON = function () {
        const jsonObj = {};

        Object.getOwnPropertyNames(this).forEach(key => {
            jsonObj[key] = this[key];
        }, this);

        return jsonObj;
    }
}
