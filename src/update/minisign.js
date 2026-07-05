import { createHash, createPublicKey, verify } from 'node:crypto';

// SPKI DER prefix for a raw Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function ed25519PublicKey(raw32) {
    return createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, raw32]),
        format: 'der',
        type: 'spki',
    });
}

/**
 * Parse a minisign public key file into its key id and raw Ed25519 key.
 * @returns {{ keyId: Buffer, key: Buffer }}
 */
export function parsePublicKey(pubText) {
    const b64 = pubText.trim().split('\n').pop().trim();
    const raw = Buffer.from(b64, 'base64');

    if (raw.length !== 42 || raw.subarray(0, 2).toString('latin1') !== 'Ed') {
        throw new Error('invalid minisign public key');
    }

    return { keyId: raw.subarray(2, 10), key: raw.subarray(10, 42) };
}

/**
 * Verify a minisign signature over a file. Handles both prehashed ('ED', blake2b-512 —
 * what modern minisign produces) and legacy ('Ed', raw). Returns true only if the key id
 * matches and BOTH the file signature and the trusted-comment global signature verify.
 * Pure Node crypto — no dependencies.
 *
 * @param {Buffer} fileBuffer   the downloaded artifact
 * @param {string} sigText      contents of the .minisig file
 * @param {string} pubText      contents of the minisign public key
 * @returns {boolean}
 */
export function verifyMinisign(fileBuffer, sigText, pubText) {
    const { keyId, key } = parsePublicKey(pubText);
    const publicKey = ed25519PublicKey(key);

    const lines = sigText.split('\n');
    const sigBytes = Buffer.from((lines[1] ?? '').trim(), 'base64'); // algo(2)+keyid(8)+sig(64)

    if (sigBytes.length !== 74) {
        return false;
    }

    const algo = sigBytes.subarray(0, 2).toString('latin1');
    const sigKeyId = sigBytes.subarray(2, 10);
    const signature = sigBytes.subarray(10, 74);

    if (!sigKeyId.equals(keyId)) {
        return false; // signed by a different key
    }

    // 1. File signature.
    let message;
    if (algo === 'ED') {
        message = createHash('blake2b512').update(fileBuffer).digest();
    } else if (algo === 'Ed') {
        message = fileBuffer;
    } else {
        return false;
    }

    if (!verify(null, message, publicKey, signature)) {
        return false;
    }

    // 2. Global signature over (file signature || trusted comment).
    const trustedComment = (lines[2] ?? '').replace(/^trusted comment: /, '');
    const globalSig = Buffer.from((lines[3] ?? '').trim(), 'base64');
    const globalMessage = Buffer.concat([signature, Buffer.from(trustedComment, 'utf8')]);

    return verify(null, globalMessage, publicKey, globalSig);
}
