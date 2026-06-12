/**
 * 极简 JSON Schema 校验器(仅覆盖预批输出所需子集:
 * type(object/array/string/number/integer/boolean) / required / properties /
 * additionalProperties / items / minimum)。
 * 不引第三方校验库 —— package.json 不在 A7 可改范围,且子集足够、确定性更好审计。
 */
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  minimum?: number;
}

export function validateJsonSchema(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(`${path}: ${msg}`);

  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail('应为 object');
        return errors;
      }
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in obj)) fail(`缺少必填字段 ${key}`);
      }
      for (const [key, v] of Object.entries(obj)) {
        const sub = schema.properties?.[key];
        if (!sub) {
          if (schema.additionalProperties === false) fail(`不允许的字段 ${key}`);
          continue;
        }
        errors.push(...validateJsonSchema(v, sub, `${path}.${key}`));
      }
      return errors;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        fail('应为 array');
        return errors;
      }
      if (schema.items) {
        value.forEach((v, i) => errors.push(...validateJsonSchema(v, schema.items!, `${path}[${i}]`)));
      }
      return errors;
    }
    case 'string':
      if (typeof value !== 'string') fail('应为 string');
      return errors;
    case 'boolean':
      if (typeof value !== 'boolean') fail('应为 boolean');
      return errors;
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        fail('应为 number');
        return errors;
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) fail('应为 integer');
      if (schema.minimum !== undefined && value < schema.minimum) fail(`应 ≥ ${schema.minimum}`);
      return errors;
    }
  }
}
