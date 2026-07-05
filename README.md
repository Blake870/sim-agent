# sim-agent

Light agent to control Steam accounts and resolve tasks for [sim.gudoguy.com](https://sim.gudoguy.com).

It runs on a machine **you** control, holds your Steam secrets locally, and talks to the sim
server over outbound HTTPS only — pairing once for a token, then heartbeating and pulling
tasks. It has no business logic of its own; it just executes Steam primitives the server asks for.

## Install

1. Download the binary for your platform from the [latest release](https://github.com/Blake870/sim-agent/releases/latest):
   - Windows: `sim-agent-win-x64.exe`
   - Linux: `sim-agent-linux-x64`
2. **Verify it** (see below).
3. On Linux/macOS, make it executable (downloaded release assets don't carry the +x bit):
   ```sh
   chmod +x sim-agent-linux-x64
   ```
4. Create a pairing code in the sim panel (**Agents → your agent → Pair machine**).
5. Run it with the code (the server URL is built in — no need to set it):
   ```sh
   AGENT_PAIRING_CODE=ABCD-EFGH ./sim-agent-linux-x64
   ```
   The token is saved to `agent-state.json` next to the binary; you won't need the code again —
   after that, just `./sim-agent-linux-x64`.

Configuration is via env vars (or a `.env` file in the working directory) — see
[`.env.example`](.env.example).

## Run as a service (recommended)

So it starts on boot and restarts if it stops.

**Linux (systemd):**
```sh
sudo ./install/install.sh --code ABCD-EFGH     # downloads latest, pairs, starts
systemctl status sim-agent                      # check
journalctl -u sim-agent -f                       # logs
sudo ./install/uninstall.sh                       # remove (keeps state; --purge wipes it)
```
Runs as a dedicated non-root `sim-agent` user; state (the token) lives in `/var/lib/sim-agent`.

**Windows (scheduled task, as Administrator):**
```powershell
.\install\install.ps1 -Code ABCD-EFGH           # downloads latest, pairs, starts at boot
Get-ScheduledTask sim-agent                       # check
Unregister-ScheduledTask sim-agent                # remove
```

Both accept `--binary` / `-Binary` to install a binary you already downloaded and verified.

**Multiple agents on one machine** — give each its own `--name` (default `sim-agent`). Each
gets a separate service and its own state/token, sharing the binary:
```sh
sudo ./install/install.sh --name work  --code ABCD-EFGH
sudo ./install/install.sh --name alt   --code WXYZ-1234
# → services `work` and `alt`, state in /var/lib/work and /var/lib/alt
```

## Verify what you downloaded

Two independent checks:

```sh
# 1. Signature — proves it was signed with the project's key.
minisign -Vm sim-agent-linux-x64 -p keys/minisign.pub

# 2. Provenance — proves it was built by CI from this repo's source.
gh attestation verify sim-agent-linux-x64 --repo Blake870/sim-agent
```

The second one is the important one for a source-available project: it ties the binary to a
specific **source commit** and the **public build workflow**, so you can read exactly what
produced your binary. (Byte-for-byte reproducible rebuilds are a stretch goal, not a claim.)

## Auto-update

The agent keeps itself patched. **On by default**, it checks each heartbeat, and when the
server reports a newer build it downloads it, **verifies the minisign signature against the
embedded public key**, swaps the binary, and restarts (automatic under systemd / the Windows
task). A download that fails verification is discarded — even a compromised server or mirror
can't hand you a tampered binary.

**If you're extra careful about what runs on a machine holding your Steam secrets**, turn it
off and drive updates yourself:
```sh
sudo ./install/install.sh --code <CODE> --no-auto-update   # at install
AGENT_AUTO_UPDATE=0 ./sim-agent-linux-x64                    # per run / in the service env
```
Then watch [Releases](https://github.com/Blake870/sim-agent/releases), read the changes,
verify each new binary (above), and swap it in on your own schedule. Either way the server
can still set a **minimum version** — below it the agent is refused task work until you update.

The preference is remembered in `agent-state.json`, so it sticks across restarts once set.

## Build from source

```sh
npm ci
npm run build      # standalone binary for the current platform (needs Node >= 20)
npm start          # or run directly from source (Node >= 18)
```

`npm run build` bundles the source into a single CommonJS file (esbuild), then uses Node's
Single Executable Applications (SEA) to produce `build/sim-agent-<os>-<arch>`. Runtime has
**zero dependencies**; esbuild/postject are build-time only.

## Releases

Pushing a `vX.Y.Z` tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml):
build per platform → checksums → **minisign** signature → **build-provenance attestation** →
publish to GitHub Releases. See [`keys/README.md`](keys/README.md) for signing-key setup.

## License

Source-available under the [Functional Source License (FSL-1.1-Apache-2.0)](LICENSE.md).
You may run and modify it for your own use, but not to build a competing product or service.
Each release converts to Apache-2.0 two years after publication.
