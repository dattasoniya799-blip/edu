#!/usr/bin/env node
/**
 * 知识点动画确定性校验器(npm run validate:anim)。
 *
 * 扫 public/animations/{初中,高中}/*.html,逐文件跑 skills/知识点动画-skill.md 的 CODE 硬规范:
 * 安全红线、必填 meta、重置按钮、色板纪律、触控尺寸、内联脚本语法、文件体积。
 * 结果打在终端,同时写出 public/animations/manifest.json 供车间页读取。
 * 任一文件失败 → 退出码 1。
 *
 * 只做机械检查:数学正确性与教学法质量靠人审。
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ANIM_DIR = path.join(ROOT, 'public', 'animations');
const MANIFEST = path.join(ANIM_DIR, 'manifest.json');

const MAX_BYTES = 120 * 1024;
const GRADES = ['初中', '高中'];
const DIFFICULTIES = ['低', '中', '高'];
const COGNITIVE = ['比较', '分解', '变换', '逼近', '守恒', '累积', '模拟'];
const DESC_MAX = 40;
const TAP_MIN = 44;

/** 每条规则:id + 一句话说明 + 检查函数(返回 null 表示通过,返回字符串表示失败原因) */
const RULES = [
  {
    id: 'size',
    label: `文件体积 ≤ ${MAX_BYTES / 1024}KB`,
    check: (f) => (f.bytes > MAX_BYTES ? `实际 ${(f.bytes / 1024).toFixed(1)}KB` : null),
  },
  {
    id: 'meta',
    label: '六项必填 meta 齐全且取值合法(grade/topic/difficulty/cognitive/desc/kpNodeId)',
    check: (f) => {
      const bad = [];
      const { meta } = f;
      if (!GRADES.includes(meta.grade)) bad.push(`grade=${JSON.stringify(meta.grade)}`);
      if (!meta.topic) bad.push('topic 空');
      if (!DIFFICULTIES.includes(meta.difficulty)) bad.push(`difficulty=${JSON.stringify(meta.difficulty)}`);
      if (!COGNITIVE.includes(meta.cognitive)) bad.push(`cognitive=${JSON.stringify(meta.cognitive)}`);
      if (!meta.desc) bad.push('desc 空');
      else if ([...meta.desc].length > DESC_MAX) bad.push(`desc ${[...meta.desc].length} 字超 ${DESC_MAX}`);
      if (meta.kpNodeId === undefined) bad.push('缺 kpNodeId(未挂载也要写空串)');
      return bad.length ? bad.join(';') : null;
    },
  },
  {
    id: 'grade-dir',
    label: 'meta.grade 与所在学段目录一致',
    check: (f) => (f.meta.grade === f.dirGrade ? null : `目录 ${f.dirGrade} / meta ${f.meta.grade}`),
  },
  {
    id: 'viewport',
    label: '声明 viewport(width=device-width)',
    check: (f) => (/<meta[^>]+name=["']viewport["'][^>]*width=device-width/i.test(f.html) ? null : '缺 viewport'),
  },
  {
    id: 'reset',
    label: '存在重置按钮(button 文案含「重置」或「重新开始」)',
    check: (f) => {
      const buttons = f.html.match(/<button\b[\s\S]*?<\/button>/gi) || [];
      return buttons.some((b) => /重置|重新开始/.test(b)) ? null : '未找到重置/重新开始按钮';
    },
  },
  {
    id: 'no-external',
    label: '无外链资源(script src / link / @import / http(s) 引用)',
    check: (f) => {
      const bad = [];
      if (/<script\b[^>]*\bsrc\s*=/i.test(f.html)) bad.push('<script src>');
      if (/<link\b/i.test(f.html)) bad.push('<link>');
      if (/@import\b/i.test(f.html)) bad.push('@import');
      if (/<iframe\b/i.test(f.html)) bad.push('<iframe>');
      const urls = f.html.match(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//gi) || [];
      if (urls.length) bad.push(`${urls.length} 处 http/协议相对引用`);
      if (/\bhttps?:\/\//i.test(f.code)) bad.push('脚本内含 http 地址');
      return bad.length ? bad.join(';') : null;
    },
  },
  {
    id: 'no-network',
    label: '无网络能力(fetch / XHR / WebSocket / EventSource / sendBeacon)',
    check: (f) => hits(f.code, [
      [/\bfetch\s*\(/, 'fetch()'],
      [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
      [/\bWebSocket\b/, 'WebSocket'],
      [/\bEventSource\b/, 'EventSource'],
      [/\bsendBeacon\b/, 'sendBeacon'],
      [/\bimportScripts\b/, 'importScripts'],
      [/\bimport\s*\(/, '动态 import()'],
    ]),
  },
  {
    id: 'no-cross-window',
    label: '无跨窗口访问(window.top / parent / opener / postMessage / open)',
    check: (f) => hits(f.code, [
      [/\bwindow\s*\.\s*top\b/, 'window.top'],
      [/\bwindow\s*\.\s*parent\b/, 'window.parent'],
      [/\bwindow\s*\.\s*opener\b/, 'window.opener'],
      [/\bparent\s*\.\s*postMessage\b/, 'parent.postMessage'],
      [/\bpostMessage\s*\(/, 'postMessage()'],
      [/\bwindow\s*\.\s*open\s*\(/, 'window.open()'],
    ]),
  },
  {
    id: 'no-storage',
    label: '无本地存储(localStorage / sessionStorage / indexedDB / cookie)',
    check: (f) => hits(f.code, [
      [/\blocalStorage\b/, 'localStorage'],
      [/\bsessionStorage\b/, 'sessionStorage'],
      [/\bindexedDB\b/, 'indexedDB'],
      [/\bdocument\s*\.\s*cookie\b/, 'document.cookie'],
    ]),
  },
  {
    id: 'no-eval',
    label: '无动态求值(eval / new Function)',
    check: (f) => hits(f.code, [
      [/\beval\s*\(/, 'eval()'],
      [/\bnew\s+Function\b/, 'new Function'],
    ]),
  },
  {
    id: 'color-vars',
    label: '颜色全部走 CSS 变量(:root 之外与脚本内不得出现裸色值)',
    check: (f) => {
      const bad = [];
      const cssOutsideRoot = f.css.replace(/:root\s*\{[\s\S]*?\}/g, '');
      const strays = [...(cssOutsideRoot.match(/#[0-9a-fA-F]{3,8}\b/g) || []),
        ...(cssOutsideRoot.match(/\b(?:rgba?|hsla?)\s*\(/g) || [])];
      if (strays.length) bad.push(`样式内 ${strays.length} 处裸色值(${strays.slice(0, 3).join(' ')})`);
      const inCode = [...(f.code.match(/["']#[0-9a-fA-F]{3,8}["']/g) || []),
        ...(f.code.match(/\b(?:rgba?|hsla?)\s*\(/g) || [])];
      if (inCode.length) bad.push(`脚本内 ${inCode.length} 处裸色值(${inCode.slice(0, 3).join(' ')})`);
      return bad.length ? bad.join(';') : null;
    },
  },
  {
    id: 'accent-limit',
    label: '强调色不超过 3 组(--hi-a / --hi-b / --hi-c)',
    check: (f) => {
      const letters = new Set([...f.css.matchAll(/--hi-([a-z])\b/g)].map((m) => m[1]));
      if (letters.size === 0) return '未声明 --hi-* 强调色变量';
      const extra = [...letters].filter((l) => !['a', 'b', 'c'].includes(l));
      return extra.length ? `多出 ${extra.map((l) => `--hi-${l}`).join(' ')}` : null;
    },
  },
  {
    id: 'tap-size',
    label: `触控目标下限 --tap ≥ ${TAP_MIN}px 且按钮引用它`,
    check: (f) => {
      const m = f.css.match(/--tap\s*:\s*(\d+(?:\.\d+)?)px/);
      if (!m) return '未声明 --tap';
      if (Number(m[1]) < TAP_MIN) return `--tap=${m[1]}px 小于 ${TAP_MIN}px`;
      return /min-height\s*:\s*var\(\s*--tap\s*\)/.test(f.css) ? null : '按钮未用 min-height:var(--tap)';
    },
  },
  {
    id: 'narrow-safe',
    label: '窄屏保护(body 声明 overflow-x:hidden)',
    check: (f) => (/body[^{]*\{[^}]*overflow-x\s*:\s*hidden/.test(f.css) ? null : 'body 缺 overflow-x:hidden'),
  },
  {
    id: 'prd-comment',
    label: 'PRD 六字段以头部注释内嵌留档',
    check: (f) => {
      const head = f.raw.slice(0, 6000);
      const fields = ['一句话定位', '核心误区', '单一认知动作', '交互流程', '分步揭示', '概念反馈'];
      const missing = fields.filter((k) => !head.includes(k));
      return missing.length ? `头部注释缺 ${missing.join('/')}` : null;
    },
  },
  {
    id: 'dom-ids',
    label: '脚本里 getElementById 取的 id 在 HTML 中都存在',
    check: (f) => {
      const declared = new Set([...f.html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
      const used = [...f.code.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
      const missing = [...new Set(used)].filter((id) => !declared.has(id));
      return missing.length ? `找不到 #${missing.join(' #')}` : null;
    },
  },
  /* ── 运动引擎(skill v2 第三章「运动」):后四条是启发式,只拦「明显没做」，
        真手感靠 npm run smoke:anim 的 jsdom 桩逐帧量,以及人审上手试。 ── */
  {
    id: 'raf-loop',
    label: '存在常驻主循环(requestAnimationFrame 且在函数内自递归)',
    check: (f) => {
      if (!/\brequestAnimationFrame\s*\(/.test(f.code)) return '没有 requestAnimationFrame';
      const names = [...new Set([...f.code.matchAll(/requestAnimationFrame\(\s*([A-Za-z_$][\w$]*)\s*\)/g)]
        .map((m) => m[1]))];
      if (names.length === 0) return 'requestAnimationFrame 没有传具名函数,查不出自递归';
      const selfCalling = names.some((n) => {
        const body = funcBody(f.code, n);
        return body !== null && new RegExp(`requestAnimationFrame\\(\\s*${n}\\s*\\)`).test(body);
      });
      return selfCalling ? null : `${names.join('/')} 里没有再排下一帧:不是常驻循环`;
    },
  },
  {
    id: 'play-button',
    label: '存在播放模式按钮(button 文案含「播放」「暂停」或「演示」)',
    check: (f) => {
      const buttons = f.html.match(/<button\b[\s\S]*?<\/button>/gi) || [];
      return buttons.some((b) => /播放|暂停|演示/.test(b)) ? null : '未找到播放/暂停/演示按钮';
    },
  },
  {
    id: 'dual-state',
    label: '状态双轨制(target/current 命名对 或 时间基缓动表达式)· 启发式',
    check: (f) => {
      // 两类命中其一即过:① 明显的目标/当前值命名对;② 明显的时间基缓动算式。
      // 故意写宽:双轨的写法很多,这里只负责拦「压根没有缓动层」的稿子。
      const namePair = /\b(?:tgt|target|targets|want|goal|desired)\b/.test(f.code) &&
        /\b(?:cur|current|shown|drawn|view|actual)\b/.test(f.code);
      const timeEase = /\(\s*1\s*-\s*Math\.pow\(/.test(f.code) ||
        /Math\.pow\([^)]*,\s*dt\s*\*/.test(f.code) ||
        /\*\s*dt\b/.test(f.code) || /\bdt\s*\*/.test(f.code) ||
        /\b(?:approach|lerp|ease|damp|towards)\w*\s*\(/i.test(f.code);
      if (namePair || timeEase) return null;
      return '既找不到 target/current 命名对,也找不到时间基缓动算式(1-Math.pow(k,dt*60) 之类)';
    },
  },
  {
    id: 'dt-clamp',
    label: 'dt 有上限保护(标签页切回来不跳跃)· 启发式',
    check: (f) => {
      if (!/\bdt\b|\bdtms\b|\bdelta\b/i.test(f.code)) return '脚本里没有 dt,主循环不是时间基的';
      // 认 Math.min(…, 50) / Math.min(50, …) / Math.min(…, 0.05) 这一族写法。
      const clamped = /Math\.min\([^;\n]{0,90}?,\s*(?:50|0?\.05)\s*\)/.test(f.code) ||
        /Math\.min\(\s*(?:50|0?\.05)\s*,[^;\n]{0,90}?\)/.test(f.code);
      return clamped ? null : '找不到 dt 上限保护(Math.min(…, 50) 之类)';
    },
  },
  {
    id: 'script-syntax',
    label: '内联脚本可被解析(语法粗检)',
    check: (f) => {
      for (const [i, body] of f.scripts.entries()) {
        try {
          // 仅解析不执行:构造函数体时如有语法错误会立刻抛出。
          new Function(body); // eslint-disable-line no-new-func
        } catch (err) {
          return `第 ${i + 1} 段 script 语法错误:${err.message}`;
        }
      }
      return null;
    },
  },
];

/**
 * 粗取一个具名函数的函数体(含大括号)。只数大括号,不解析字符串里的括号 ——
 * 动画脚本都很简单,够用;取不到就让规则报「查不出自递归」,由人去看。
 */
function funcBody(code, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(code);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let j = start; j < code.length; j++) {
    if (code[j] === '{') depth += 1;
    else if (code[j] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start, j + 1);
    }
  }
  return null;
}

function hits(text, pairs) {
  const found = pairs.filter(([re]) => re.test(text)).map(([, name]) => name);
  return found.length ? found.join(';') : null;
}

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, ' ');
}

function pickMeta(html) {
  const meta = {};
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = m[1];
    const name = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i);
    if (!name) continue;
    const content = attrs.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    meta[name[1]] = content ? content[1].trim() : '';
  }
  return meta;
}

function pickBlocks(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]);
}

async function listAnimations() {
  const out = [];
  let grades;
  try {
    grades = await readdir(ANIM_DIR, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const g of grades) {
    if (!g.isDirectory()) continue;
    const files = await readdir(path.join(ANIM_DIR, g.name));
    for (const name of files.filter((n) => n.toLowerCase().endsWith('.html')).sort()) {
      out.push({ dirGrade: g.name, name, abs: path.join(ANIM_DIR, g.name, name) });
    }
  }
  return out;
}

async function loadFile(entry) {
  const raw = await readFile(entry.abs, 'utf8');
  const { size } = await stat(entry.abs);
  const html = stripComments(raw);
  const scripts = pickBlocks(html, 'script');
  return {
    ...entry,
    raw,
    html,
    bytes: size,
    meta: pickMeta(html),
    css: pickBlocks(html, 'style').join('\n'),
    scripts,
    code: scripts.join('\n'),
  };
}

const ICON = { pass: '✓', fail: '✗' };

async function main() {
  const entries = await listAnimations();
  if (entries.length === 0) {
    console.error(`✗ ${path.relative(ROOT, ANIM_DIR)} 下没有找到任何 .html 动画`);
    process.exit(1);
  }

  const items = [];
  let failed = 0;

  for (const entry of entries) {
    const file = await loadFile(entry);
    const issues = [];
    for (const rule of RULES) {
      const reason = rule.check(file);
      if (reason) issues.push({ rule: rule.id, label: rule.label, reason });
    }
    const ok = issues.length === 0;
    if (!ok) failed += 1;

    const rel = `${file.dirGrade}/${file.name}`;
    console.log(`${ok ? ICON.pass : ICON.fail} ${rel}  ${(file.bytes / 1024).toFixed(1)}KB` +
      `  [${file.meta.cognitive || '?'}]  kpNodeId=${file.meta.kpNodeId ? file.meta.kpNodeId : '(空)'}`);
    for (const i of issues) console.log(`    - ${i.rule}:${i.label} → ${i.reason}`);

    items.push({
      path: `animations/${file.dirGrade}/${file.name}`,
      title: file.name.replace(/\.html$/i, ''),
      grade: file.meta.grade || file.dirGrade,
      meta: {
        grade: file.meta.grade ?? '',
        topic: file.meta.topic ?? '',
        difficulty: file.meta.difficulty ?? '',
        cognitive: file.meta.cognitive ?? '',
        desc: file.meta.desc ?? '',
        kpNodeId: file.meta.kpNodeId ?? '',
      },
      sizeKB: Number((file.bytes / 1024).toFixed(1)),
      validation: { ok, checked: RULES.length, issues: issues.map((i) => `${i.rule}: ${i.reason}`) },
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString().slice(0, 10),
    generator: 'apps/lab/tools/validate-animations.mjs',
    rules: RULES.map((r) => ({ id: r.id, label: r.label })),
    total: items.length,
    passed: items.length - failed,
    items,
  };
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(`检查项 ${RULES.length} 条 · 动画 ${items.length} 个 · 通过 ${items.length - failed} 个`);
  console.log(`manifest → ${path.relative(ROOT, MANIFEST)}`);
  if (failed > 0) {
    console.error(`\n✗ ${failed} 个文件未通过,人审前请先修。`);
    process.exit(1);
  }
  console.log('\n✓ 全部通过。下一步:实验区「知识点动画」车间页逐个试玩,再走人审。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
