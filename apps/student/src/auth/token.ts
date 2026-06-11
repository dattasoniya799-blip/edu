/** token 存内存 + localStorage(任务卡 B1 要求) */
const KEY = 'qiming.student.token';

let token: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;

export const getToken = (): string | null => token;

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem(KEY, t);
  else localStorage.removeItem(KEY);
}
