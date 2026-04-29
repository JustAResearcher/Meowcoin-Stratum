'use strict';

process.on('uncaughtException', err => {
    console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

const Stratum = require('./libs/class.Stratum');
const config = require('./config_testnet4.json');

const stratum = new Stratum(config);

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
    console.log(`Client disconnected: ${ev.client.socket.remoteAddress} (${ev.reason})`);
});

stratum.on(Stratum.EVENT_SHARE_SUBMITTED, ev => {
    if (ev.share.isValidBlock) {
        console.log(`*** BLOCK FOUND! height=${ev.share.jobHeight} hash=${ev.share.blockId} ***`);
    }
});
