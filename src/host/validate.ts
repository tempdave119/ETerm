export function readRecord(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${label} 必须是对象`);
  }
  return raw as Record<string, unknown>;
}

export function readString(raw: unknown, label: string, maxLength: number): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > maxLength) {
    throw new Error(`${label} 必须是 1–${maxLength} 字符的字符串`);
  }
  return raw;
}

export function readInteger(raw: unknown, label: string, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new Error(`${label} 必须是 ${min}–${max} 的整数`);
  }
  return raw;
}

export function readOptionalString(raw: unknown, label: string, maxLength: number): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  return readString(raw, label, maxLength);
}

export function readOptionalInteger(
  raw: unknown,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  return readInteger(raw, label, min, max);
}
