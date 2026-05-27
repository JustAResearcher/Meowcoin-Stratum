# MeowSolo

**A friendlier Meowcoin (MEWC) solo-mining stratum server.**

Forked from [JustAResearcher/Meowcoin-Stratum](https://github.com/JustAResearcher/Meowcoin-Stratum) v1.2.0 — same MeowPoW engine, same APEX/legacy consensus support, same community-fund split. The mining is unchanged. What's new is everything around it:

- **Setup wizard** — finds your `meowcoin.conf`, reads RPC creds, detects mainnet vs testnet, auto-picks APEX vs legacy consensus, validates your payout address. About 30 seconds end-to-end.
- **Live web dashboard** at `http://localhost:8080` — workers, hashrate, recent shares, blocks found, node status. Updates in real time.
- **One binary, no install** — Windows `.exe` or Linux binary. No Node.js, no `npm install`, no Visual Studio Build Tools.
- **Real error messages** when something's wrong — "Meowcoin Core isn't running" instead of an unhandled rejection.
- **Single command** for mainnet and testnet (`--testnet` flag), not two scripts.

## Quick start (Windows)

1. Make sure Meowcoin Core is running and synced. In `meowcoin.conf`, set:
   ```
   server=1
   rpcuser=<anything>
   rpcpassword=<a-long-random-string>
   ```
   Restart Core after editing.

2. Download `MeowSolo-windows-x64.zip` from [Releases](#), unzip anywhere.

3. Double-click `meowsolo.exe`. The wizard takes you through:
   - confirms it found your Meowcoin Core config
   - asks for your **M-prefix payout address** (validated against the network)
   - picks a stratum port (default 3333)
   - writes `config.json`

4. Point your miner at `stratum+tcp://<your-pc-ip>:3333` with any username (the worker name shows up on the dashboard).

5. Open `http://localhost:8080` to see live stats.

## Quick start (Linux)

```bash
wget https://github.com/JustAResearcher/Meowcoin-Stratum/releases/download/vX.Y.Z/MeowSolo-linux-x86_64.tar.gz
tar xzf MeowSolo-linux-x86_64.tar.gz
cd meowsolo
./meowsolo
```

If `meowcoin.conf` isn't where Meowcoin Core would put it (`~/.meowcoin/`), the wizard will ask for the path.

## CLI

```
meowsolo                  Run mining (interactive wizard on first run)
meowsolo init             Re-run the setup wizard
meowsolo --testnet        Default to testnet during the wizard
meowsolo --no-dashboard   Skip the local web dashboard
meowsolo --config PATH    Use a non-default config.json
meowsolo --port N         Override dashboard port (default 8080)
meowsolo --version
meowsolo --help
```

## What if something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `Couldn't connect to Meowcoin Core at 127.0.0.1:9766` | Meowcoin Core isn't running, or `server=1` isn't set | Start Meowcoin Core; add `server=1` to `meowcoin.conf` and restart |
| `Meowcoin Core rejected the RPC username/password (401)` | The rpcuser/rpcpassword in `config.json` doesn't match `meowcoin.conf` | Delete `config.json`, re-run the wizard |
| `Invalid coinbaseAddress` | Address has a typo, or you used a testnet address on mainnet (or vice versa) | Run `meowsolo init` and paste a fresh address from your wallet |
| Miner connects but no shares accepted | Stratum difficulty too high for your hashrate | Edit `config.json` and lower `port.diff` (try 10000) |

## Building from source

```bash
git clone https://github.com/JustAResearcher/Meowcoin-Stratum.git meowsolo
cd meowsolo
npm install
node bin/meowsolo.js
```

To produce single-file binaries (uses [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg)):

```bash
npm run build:win    # → dist/meowsolo.exe
npm run build:linux  # → dist/meowsolo
```

## Configuration reference

After the wizard runs, `config.json` looks like:

```json
{
  "consensus": "apex",
  "network": "mainnet",
  "coinbaseAddress": "MFMrgv31Z3mTs2DehcTht2rgrnn41B6PzT",
  "devAddress": "MPyNGZSSZ4rbjkVJRLn3v64pMcktpEYJnU",
  "devRewardPercent": 40,
  "host": "0.0.0.0",
  "port": { "number": 3333, "diff": 100000 },
  "rpc": {
    "host": "127.0.0.1",
    "port": 9766,
    "user": "rpcuser",
    "password": "..."
  },
  "jobUpdateInterval": 55,
  "blockPollIntervalMs": 250,
  "blockLogFile": "block_finds.xlsx",
  "dashboard": { "enabled": true, "port": 8080 }
}
```

Tweakable fields:

- `port.diff` — initial stratum share difficulty. Roughly tune to `farm_MHs * 1.5`. Too high = no shares; too low = console flood.
- `dashboard.enabled` — set `false` (or pass `--no-dashboard`) to skip the web UI.
- `dashboard.port` — change if 8080 is taken.
- `consensus` — `apex` for current Meowcoin Core, `legacy` for the pre-APEX 3.0.6 nodes. Auto-detected by the wizard.

## Block-find logging

When a block is found, a row gets appended to `block_finds.xlsx` next to the binary: timestamp, height, reward (sats), worker, nonce, txid. Useful for record-keeping and tax season.

## Credits

- [JustAResearcher/Meowcoin-Stratum](https://github.com/JustAResearcher/Meowcoin-Stratum) — upstream Meowcoin stratum + APEX consensus switch
- [LabyrinthCore/kawpow-stratum](https://github.com/LabyrinthCore/kawpow-stratum) — original kawpow-stratum base
- The MintPond libraries (`mint-bitcoin-script`, `mint-bos`, `mint-merkle`, etc.)

## License

MIT. See `LICENSE`.
