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
3. Create a pairing code in the sim panel (**Agents → your agent → Pair machine**).
4. Run it with the code:
   ```sh
   AGENT_SERVER_URL=https://sim.gudoguy.com AGENT_PAIRING_CODE=ABCD-EFGH ./sim-agent-linux-x64
   ```
   The token is saved to `agent-state.json` next to the binary; you won't need the code again.

Configuration is via env vars (or a `.env` file in the working directory) — see
[`.env.example`](.env.example).

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
