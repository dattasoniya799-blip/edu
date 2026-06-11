/**
 * @qiming/contracts · 类型化 fetch 客户端
 * 类型来源:src/generated/api-types.ts(由 openapi.yaml 生成,npm run gen:sdk 重新生成)
 * 三端统一使用本客户端;mock 模式下由 msw 按同一份 openapi.yaml 拦截。
 */
import type { paths } from './generated/api-types';

type Method = 'get' | 'post' | 'put' | 'delete';
type PathsWith<M extends Method> = { [P in keyof paths]: paths[P] extends Record<M, unknown> ? P : never }[keyof paths];
type Op<P extends keyof paths, M extends Method> = paths[P] extends Record<M, infer O> ? O : never;
type JsonBody<O> = O extends { requestBody: { content: { 'application/json': infer B } } } ? B : O extends { requestBody?: { content: { 'application/json': infer B } } } ? B | undefined : undefined;
type Ok<O> = O extends { responses: { 200: { content: { 'application/json': infer R } } } } ? R : unknown;
type Query<O> = O extends { parameters: { query?: infer Q } } ? Q : undefined;
type PathParams<O> = O extends { parameters: { path: infer PP } } ? PP : undefined;

export interface ClientOptions {
  baseUrl?: string;                      // 默认 /api/v1
  getToken?: () => string | null;        // Bearer
  onUnauthorized?: () => void;           // 401 统一处理(跳登录)
  fetchImpl?: typeof fetch;
}

export class ApiError extends Error {
  constructor(public code: number, message: string, public detail?: unknown, public httpStatus?: number) { super(message); }
}

export function createClient(opts: ClientOptions = {}) {
  const base = opts.baseUrl ?? '/api/v1';
  const f = opts.fetchImpl ?? fetch;

  async function call<P extends keyof paths, M extends Method>(
    method: M, path: P,
    args: { params?: PathParams<Op<P, M>>; query?: Query<Op<P, M>>; body?: JsonBody<Op<P, M>> } = {},
  ): Promise<Ok<Op<P, M>>> {
    let url = base + String(path);
    if (args.params) for (const [k, v] of Object.entries(args.params as Record<string, unknown>))
      url = url.replace(`{${k}}`, encodeURIComponent(String(v)));
    if (args.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(args.query as Record<string, unknown>))
        if (v !== undefined && v !== null) qs.set(k, String(v));
      const s = qs.toString(); if (s) url += `?${s}`;
    }
    const token = opts.getToken?.();
    const res = await f(url, {
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
    });
    if (res.status === 401) opts.onUnauthorized?.();
    const json = (await res.json().catch(() => ({ code: -1, message: `HTTP ${res.status}` }))) as { code: number; message: string; detail?: unknown };
    if (!res.ok || json.code !== 0) throw new ApiError(json.code ?? -1, json.message ?? 'error', json.detail, res.status);
    return json as Ok<Op<P, M>>;
  }

  return {
    get:  <P extends PathsWith<'get'>>(p: P, a?: { params?: PathParams<Op<P, 'get'>>; query?: Query<Op<P, 'get'>> }) => call('get', p, a ?? {}),
    post: <P extends PathsWith<'post'>>(p: P, a?: { params?: PathParams<Op<P, 'post'>>; body?: JsonBody<Op<P, 'post'>> }) => call('post', p, a ?? {}),
    put:  <P extends PathsWith<'put'>>(p: P, a?: { params?: PathParams<Op<P, 'put'>>; body?: JsonBody<Op<P, 'put'>> }) => call('put', p, a ?? {}),
    del:  <P extends PathsWith<'delete'>>(p: P, a?: { params?: PathParams<Op<P, 'delete'>> }) => call('delete', p, a ?? {}),
  };
}
