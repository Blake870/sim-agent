# Release signing keys

Releases are signed with [minisign](https://jedisct1.github.io/minisign/). The **public**
key lives here (`minisign.pub`, committed) so anyone can verify a download and so the agent
can embed it to verify auto-updates. The **secret** key is never committed — it lives only
as a GitHub Actions secret.

## One-time setup (operator)

```sh
# Generate a password-less key (so CI can sign non-interactively).
minisign -G -W -p keys/minisign.pub -s minisign.key

# Commit the PUBLIC key.
git add keys/minisign.pub && git commit -m "Add release signing public key"

# Add the SECRET key to GitHub Actions (repo → Settings → Secrets → Actions):
#   MINISIGN_SECRET_KEY = <full contents of minisign.key>
# Then delete the local secret key file (it's gitignored, but don't leave it lying around).
```

## Verifying a downloaded release

```sh
minisign -Vm sim-agent-linux-x64 -p keys/minisign.pub
```

Provenance (that the binary was built from this repo's source by CI) is verified separately:

```sh
gh attestation verify sim-agent-linux-x64 --repo Blake870/sim-agent
```
