import { describe, expect, it } from 'vitest'
import { checkHtmlStatic, fallbackSvg, HTML_MAX_BYTES } from '../src/assets/animation-html'

const GOOD = `<!doctype html><html><body><canvas id="c" width="300" height="200"></canvas>
<script>
const api = { do(name, params) { return name; }, unlock(p) {}, reset() {} };
window.lecture = api;
parent.postMessage({ type: 'lecture:ready' }, '*');
</script></body></html>`

describe('checkHtmlStatic · 第一道校验(静态扫描)', () => {
  it('合格的自包含 HTML 通过', () => {
    expect(checkHtmlStatic(GOOD)).toEqual([])
  })
  it('超过 30 KB 不过', () => {
    const fat = GOOD + '<!--' + 'x'.repeat(HTML_MAX_BYTES) + '-->'
    expect(checkHtmlStatic(fat).some((e) => e.includes('KB'))).toBe(true)
  })
  it('用了网络访问不过', () => {
    for (const bad of ['fetch(', 'XMLHttpRequest', 'import(']) {
      expect(checkHtmlStatic(GOOD.replace('const api', `${bad} const api`)).length).toBeGreaterThan(0)
    }
  })
  it('外链 script / link 不过', () => {
    expect(checkHtmlStatic(GOOD.replace('<body>', '<body><script src="x.js"></script>')).length).toBeGreaterThan(0)
    expect(checkHtmlStatic(GOOD.replace('<body>', '<body><link href="x.css">')).length).toBeGreaterThan(0)
  })
  it('http(s) 外链地址不过,但 data: 允许', () => {
    expect(checkHtmlStatic(GOOD.replace('const api', '// https://cdn.example.com \n const api')).length).toBeGreaterThan(0)
    expect(checkHtmlStatic(GOOD.replace('<canvas', '<img src="data:image/png;base64,AAAA"><canvas'))).toEqual([])
  })
  it('没暴露 window.lecture 不过', () => {
    expect(checkHtmlStatic(GOOD.replace('window.lecture = api;', '')).some((e) => e.includes('window.lecture'))).toBe(true)
  })
  it('没发 lecture:ready 不过', () => {
    expect(checkHtmlStatic(GOOD.replace("'lecture:ready'", "'nope'")).some((e) => e.includes('lecture:ready'))).toBe(true)
  })
  it('空字符串不过', () => {
    expect(checkHtmlStatic('').length).toBeGreaterThan(0)
  })
})

describe('fallbackSvg · 两次都没过时的静态降级', () => {
  it('生成一张带说明文字的 SVG', () => {
    const svg = fallbackSvg('演示正方形绕 A 点旋转 α 角后 BE′ 与 DF′ 相等')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('旋转')
  })
  it('转义掉会破坏 SVG 的字符', () => {
    const svg = fallbackSvg('a < b & c > d')
    expect(svg).toContain('&lt;')
    expect(svg).toContain('&gt;')
    expect(svg).toContain('&amp;')
  })
})
