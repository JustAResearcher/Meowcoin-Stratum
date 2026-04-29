Meowcoin-Stratum
================

Meowcoin (MEWC) Node.js solo-mining stratum server — MeowPoW.

Forked from [LabyrinthCore/kawpow-stratum](https://github.com/LabyrinthCore/kawpow-stratum) and adapted for Meowcoin: community-fund split (40 % of every block subsidy to `MPyNGZSSZ4rbjkVJRLn3v64pMcktpEYJnU`), MeowPoW light-verify (`libs/meowpow_light.js`), Excel block-find logging.

This project has been developed and tested on [Node v18+](https://nodejs.org/), Ubuntu 20.04 / 22.04, and Windows 10/11.

## Install — from source

__Linux (Ubuntu / Debian / HiveOS)__
```bash
sudo apt-get install -y build-essential
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
source ~/.bashrc
nvm install 18

git clone https://github.com/JustAResearcher/Meowcoin-Stratum.git
cd Meowcoin-Stratum
npm install
```

__Windows__
1. Install [Node.js LTS](https://nodejs.org/) and Visual Studio Build Tools (the C++ workload — needed to compile the native MeowPoW addon).
2. Clone the repo and `npm install`.

## Configure

```bash
cp config.example.json config.json
# edit config.json — set coinbaseAddress and rpc credentials
```

## Run

```bash
node start.js                # mainnet
node start_testnet4.js       # testnet4
```

When the node accepts a block found by your miner, a row is appended to `block_finds.xlsx` in the working directory (date, height, reward, MEWC/USDT price, USD/CAD value, coinbase TxID, worker, nonce, cumulative totals).

## Use as a module

```javascript
const Stratum = require('meowcoin-stratum').Stratum;

class MyStratum extends Stratum {
    /* Override */
    canAuthorizeWorker(client, callback) {
        if (client.minerAddress === 'bad') {
            callback(null, false);
        }
        else {
            callback(null, true);
        }
    }
}

const stratum = new MyStratum({
    coinbaseAddress: 'MFMrgv31Z3mTs2DehcTht2rgrnn41B6PzT',
    blockBrand: 'Meowcoin Solo Miner',
    host: '0.0.0.0',
    port: {
        number: 3333,
        diff: 100000  // ~1.5 × MH/s of farm hashrate
    },
    rpc: {
        host: '127.0.0.1',
        port: 9766,
        user: 'meowminer',
        password: 'change-me'
    },
    jobUpdateInterval: 55,
    blockPollIntervalMs: 250
});

stratum.on(Stratum.EVENT_SHARE_SUBMITTED, ev => {
    console.log(ev.share);
});

stratum.init();
```
