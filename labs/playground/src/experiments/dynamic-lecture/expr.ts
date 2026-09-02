/**
 * 受限表达式编译器:把剧本里的表达式字符串安全地变成可求值函数。
 *
 * 为什么不用 eval/new Function:剧本将来由 LLM 生成,表达式是不可信输入;
 * 这里用自写的递归下降解析器 + 函数白名单,未知标识符直接抛错(ArchSight 三段式校验同思路)。
 *
 * 支持:数字、变量(x 与场景参数名)、+ - * / ^、括号、一元负号、
 * 白名单函数 sin cos tan asin acos atan sqrt abs exp log ln pow min max floor ceil round,
 * 常量 pi、e。
 */

type Vars = Record<string, number>;
export type CompiledExpr = (vars: Vars) => number;

const FUNCS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  log: Math.log10,
  ln: Math.log,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Tok =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      // 科学计数法:1e3 / 2.5E-4(LLM 产出常见写法)
      if (j < src.length && (src[j] === 'e' || src[j] === 'E')) {
        let k = j + 1;
        if (k < src.length && (src[k] === '+' || src[k] === '-')) k++;
        if (k < src.length && /[0-9]/.test(src[k])) {
          while (k < src.length && /[0-9]/.test(src[k])) k++;
          j = k;
        }
      }
      const raw = src.slice(i, j);
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new Error(`非法数字「${raw}」`);
      toks.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^(),'.includes(c)) {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(`非法字符「${c}」(表达式:${src})`);
  }
  return toks;
}

/** 递归下降:expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ; unary := '-' unary | power ; power := atom ('^' unary)? */
function parse(src: string, allowedVars: Set<string>): CompiledExpr {
  const toks = tokenize(src);
  let pos = 0;

  const peek = () => toks[pos];
  const eat = (v?: string): Tok => {
    const tok = toks[pos];
    if (!tok) throw new Error(`表达式意外结束(${src})`);
    if (v !== undefined && !(tok.t === 'op' && tok.v === v)) {
      throw new Error(`期望「${v}」,得到「${'v' in tok ? tok.v : ''}」(${src})`);
    }
    pos++;
    return tok;
  };

  function atom(): CompiledExpr {
    const tok = peek();
    if (!tok) throw new Error(`表达式意外结束(${src})`);
    if (tok.t === 'num') {
      pos++;
      const v = tok.v;
      return () => v;
    }
    if (tok.t === 'op' && tok.v === '(') {
      eat('(');
      const inner = addExpr();
      eat(')');
      return inner;
    }
    if (tok.t === 'id') {
      pos++;
      const name = tok.v;
      const next = peek();
      if (next && next.t === 'op' && next.v === '(') {
        const fn = FUNCS[name];
        if (!fn) throw new Error(`未知函数「${name}」(白名单外)`);
        eat('(');
        const args: CompiledExpr[] = [addExpr()];
        while (peek() && peek().t === 'op' && (peek() as { v: string }).v === ',') {
          eat(',');
          args.push(addExpr());
        }
        eat(')');
        return (vars) => fn(...args.map((a) => a(vars)));
      }
      if (name in CONSTS) {
        const v = CONSTS[name];
        return () => v;
      }
      if (!allowedVars.has(name)) throw new Error(`未知变量「${name}」(允许:${[...allowedVars].join(', ') || '无'})`);
      return (vars) => {
        const v = vars[name];
        if (v === undefined || !Number.isFinite(v)) throw new Error(`变量「${name}」无有效值`);
        return v;
      };
    }
    throw new Error(`无法解析「${'v' in tok ? tok.v : ''}」(${src})`);
  }

  function power(): CompiledExpr {
    const base = atom();
    const next = peek();
    if (next && next.t === 'op' && next.v === '^') {
      eat('^');
      const ex = unary();
      return (vars) => Math.pow(base(vars), ex(vars));
    }
    return base;
  }

  function unary(): CompiledExpr {
    const tok = peek();
    if (tok && tok.t === 'op' && tok.v === '-') {
      eat('-');
      const inner = unary();
      return (vars) => -inner(vars);
    }
    if (tok && tok.t === 'op' && tok.v === '+') {
      eat('+');
      return unary();
    }
    return power();
  }

  function mulExpr(): CompiledExpr {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (tok && tok.t === 'op' && (tok.v === '*' || tok.v === '/')) {
        const op = tok.v;
        pos++;
        const right = unary();
        const l = left;
        left = op === '*' ? (vars) => l(vars) * right(vars) : (vars) => l(vars) / right(vars);
      } else break;
    }
    return left;
  }

  function addExpr(): CompiledExpr {
    let left = mulExpr();
    for (;;) {
      const tok = peek();
      if (tok && tok.t === 'op' && (tok.v === '+' || tok.v === '-')) {
        const op = tok.v;
        pos++;
        const right = mulExpr();
        const l = left;
        left = op === '+' ? (vars) => l(vars) + right(vars) : (vars) => l(vars) - right(vars);
      } else break;
    }
    return left;
  }

  const fn = addExpr();
  if (pos !== toks.length) throw new Error(`表达式尾部有多余内容(${src})`);
  return fn;
}

const cache = new Map<string, CompiledExpr>();

/** 编译表达式;allowedVars = ['x', ...参数名]。编译失败抛中文错误(质检门直接展示)。 */
export function compileExpr(src: string, allowedVars: string[]): CompiledExpr {
  if (src.length > 512) throw new Error('表达式过长(上限 512 字符)');
  const key = `${[...allowedVars].sort().join(',')}|${src}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const toks = tokenize(src);
  if (toks.length > 400) throw new Error('表达式过于复杂(上限 400 个记号)');
  const fn = parse(src, new Set(allowedVars));
  cache.set(key, fn);
  return fn;
}

const TPL_RE = /\{([^:}]+)(?::(\d))?\}/g;

/** 从模板文本中提取全部 {表达式} 片段(质检门校验用) */
export function extractTemplateExprs(tpl: string): string[] {
  const out: string[] = [];
  for (const m of tpl.matchAll(TPL_RE)) out.push(m[1].trim());
  return out;
}

/** 求值模板:"挂 {m:1} kg → 长 {0.5*m+12:1} cm";失败的占位符显示 "?" */
export function evalTemplate(tpl: string, vars: Vars, allowedVars: string[]): string {
  return tpl.replace(TPL_RE, (_all, expr: string, d?: string) => {
    try {
      return compileExpr(expr.trim(), allowedVars)(vars).toFixed(d ? Number(d) : 1);
    } catch {
      return '?';
    }
  });
}

/** 数值或表达式 → 求值(剧本里坐标既可写 3 也可写 "k*2+1") */
export function evalNumOrExpr(v: number | string, vars: Vars, allowedVars: string[]): number {
  if (typeof v === 'number') return v;
  return compileExpr(v, allowedVars)(vars);
}

/** 质检门:跑剧本自查算例,返回错误列表(空 = 通过) */
export function runReferenceChecks(
  checks: { desc: string; expr: string; params: Record<string, number>; expected: number; tol: number }[] | undefined,
  paramIds: string[],
): string[] {
  if (!checks) return [];
  const errors: string[] = [];
  for (const c of checks) {
    try {
      const fn = compileExpr(c.expr, ['x', ...paramIds]);
      const got = fn(c.params);
      if (!Number.isFinite(got) || Math.abs(got - c.expected) > c.tol) {
        errors.push(`自查「${c.desc}」失败:期望 ${c.expected},得到 ${got}`);
      }
    } catch (err) {
      errors.push(`自查「${c.desc}」表达式错误:${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}
