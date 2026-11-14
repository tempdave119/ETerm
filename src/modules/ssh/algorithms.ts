import type { Algorithms } from 'ssh2';

/**
 * SSH 算法白名单：在 ssh2 默认的现代集合上做减法，去掉 SHA-1 与任何 CBC。
 * 用显式列表而不是“跟随库默认”，是为了让安全基线由我们决定：库升级带来的默认变化
 * 不会静默生效，服务器降级协商也没有可利用的弱选项。
 */
export const SSH_ALGORITHMS: Algorithms = {
  kex: [
    'curve25519-sha256@libssh.org',
    'curve25519-sha256',
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group-exchange-sha256',
    'diffie-hellman-group14-sha256',
    'diffie-hellman-group15-sha512',
    'diffie-hellman-group16-sha512',
    'diffie-hellman-group17-sha512',
    'diffie-hellman-group18-sha512',
  ],
  cipher: [
    'aes128-gcm@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-ctr',
    'aes192-ctr',
    'aes256-ctr',
  ],
  // 不列 chacha20-poly1305@openssh.com：Electron 的 Node（BoringSSL）没有原始 chacha20
  // cipher，只要显式列出就会在协商前报 Unsupported algorithm；AES-GCM / CTR 已覆盖全部主流服务端。
  // 去掉 ssh-rsa（SHA-1 签名），保留 rsa-sha2-* 与 ed25519 / ecdsa。
  serverHostKey: [
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'rsa-sha2-512',
    'rsa-sha2-256',
  ],
  // 去掉 hmac-sha1 与 hmac-sha1-etm。
  hmac: [
    'hmac-sha2-256-etm@openssh.com',
    'hmac-sha2-512-etm@openssh.com',
    'hmac-sha2-256',
    'hmac-sha2-512',
  ],
  compress: ['none', 'zlib@openssh.com', 'zlib'],
};
