'use strict';

// pkg-friendly direct require of the native MeowPoW addon. The upstream
// @mintpond/hasher-kawpow/index.js uses `bindings()` to locate the .node file,
// which pkg's snapshot prelude can't follow. Loading via an explicit path lets
// pkg bundle the addon as an asset, while still working under plain `node`.
const path = require('path');
const addonPath = path.join(
    path.dirname(require.resolve('@mintpond/hasher-kawpow/package.json')),
    'build', 'Release', 'kawpowhasher.node'
);
const meowpow = require(addonPath);

module.exports = {
    diff1: 0x00000000ffff0000000000000000000000000000000000000000000000000000,
    multiplier: Math.pow(2, 8),
    epochLen: 7500,
    verify: (headerHashBuf, nonceBuf, blockHeight, mixHashBuf, hashOutBuf) => {
        return meowpow.verify(headerHashBuf, nonceBuf, blockHeight, mixHashBuf, hashOutBuf);
    }
};