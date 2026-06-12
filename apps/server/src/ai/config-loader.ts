import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * AI 配置文件加载(提示词/审查规则/模板/默认路由表都在 src/ai/config/,不写死在代码里)。
 * 解析顺序:AI_CONFIG_DIR 环境变量 → <cwd>/src/ai/config(npm start / jest 的 cwd 都是
 * apps/server,源码随仓库分发)→ __dirname/config(ts-jest 直跑 TS 时)。
 * 文本类配置进程内缓存(路由表的热更新走 Redis,见 route-table.service.ts)。
 */
const cache = new Map<string, string>();

export function aiConfigDir(): string {
  const candidates = [
    process.env.AI_CONFIG_DIR,
    join(process.cwd(), 'src/ai/config'),
    join(__dirname, 'config'),
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(`AI 配置目录不存在,已尝试:${candidates.join(' | ')}`);
}

export function loadAiConfigText(file: string): string {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const text = readFileSync(join(aiConfigDir(), file), 'utf8').trim();
  cache.set(file, text);
  return text;
}

export function loadAiConfigJson<T>(file: string): T {
  return JSON.parse(loadAiConfigText(file)) as T;
}
