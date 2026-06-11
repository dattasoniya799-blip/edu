/** 日志脱敏(宪法 §7:手机号等敏感字段不得出现在日志) */
const PHONE_RE = /(?<!\d)(1[3-9]\d)(\d{4})(\d{4})(?!\d)/g;

export function maskSensitive(text: string): string {
  return text.replace(PHONE_RE, '$1****$3');
}

/** 深度脱敏对象中的字符串值(用于审计 detail 等结构化数据) */
export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') return maskSensitive(value) as unknown as T;
  if (Array.isArray(value)) return value.map(maskDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskDeep(v);
    return out as unknown as T;
  }
  return value;
}
