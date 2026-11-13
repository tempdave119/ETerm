const FINGERPRINT_PATTERN = /(SHA256:[A-Za-z0-9+/]+)/;

/** 从产品错误的 detail 里取出主机指纹，供确认弹窗展示与 known_hosts 保存。 */
export function extractFingerprint(text: string): string | null {
  const match = FINGERPRINT_PATTERN.exec(text);
  return match ? match[1]! : null;
}
