import { createHash } from 'node:crypto';

/** ssh-keygen 风格的 SHA256 指纹，用于 known_hosts 比对与首次连接提示。 */
export function fingerprintOf(hostKey: Buffer): string {
  const digest = createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}
