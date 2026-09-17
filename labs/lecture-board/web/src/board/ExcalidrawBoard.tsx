/**
 * 画布适配层 —— **本仓库唯一 import @excalidraw/excalidraw 的文件**(shared/protocol.md「画布底座」)。
 *
 * 口径:
 *  - 每张可见卡 = 一块卡纸(`rectangle`:米白底 + 手绘描边)+ 一个全透明的 `embeddable`
 *    (link = card://<cardId>),`renderEmbeddable` 在里面渲染我们的纯 React 卡片。
 *    拆成两个元素是因为 embeddable 的底色画在所有普通元素之后,不拆的话红圈会被卡纸盖掉;
 *    拆开后顺序是 卡纸 → 红圈(`ellipse`)→ 透明 embeddable,圈就压在纸上、字下(见 ISSUES.md W6)。
 *  - 列标题 = `text` 元素(Excalifont + Xiaolai 手写体,紫色)+ 身后一块黄色矩形当马克笔。
 *  - 卡高由 CardHost 的 ResizeObserver 量出来回传,改元素 height 并重排同列下方元素(nextY 游标)。
 *  - 对外只暴露 reveal / fx / clearFx / focus / setZoom / addColumn,播放器调度器只认这个接口。
 */
import { Excalidraw, FONT_FAMILY } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { TAKEAWAY_GROUPS } from '../lib/audio-keys';
import { takeawayTarget } from '../lib/flow';
import type { BoardScript, Card, Column } from '../types';
import { CardView, ExploreCard } from '../components/cards/Cards';
import { CardHost, type Box, type CardMetrics } from './CardHost';
import {
  CARD_GAP,
  COL_GAP,
  COL_W,
  cardIdFromElement,
  cardLink,
  elementIds,
  layoutBoard,
  type BoardLayout,
} from './layout';

/* eslint-disable @typescript-eslint/no-explicit-any */
type SceneElement = any;

export const EXPLORE_CARD_ID = '__explore';

const PURPLE = '#6741d9';
const PAPER = '#fffdf5';
const INK = '#3d3d3d';
const MARKER = '#fde68a';

export interface FxRequest {
  kind: 'circle' | 'underline' | 'pulse';
  target: string;
  snippet?: string;
  color?: string;
}

/** 取景边距:列标题贴在工具栏下方,不居中(居中会让内容整体掉到屏幕中下部)。 */
const MARGIN = { left: 56, top: 28, cardTop: 88 };

/** 播放器唯一认识的白板接口(换底座只换本文件)。 */
export interface BoardApi {
  reveal(target: string, opts?: { instant?: boolean }): void;
  fx(req: FxRequest): void;
  clearFx(): void;
  /**
   * emph:'circle' 念到时画的手绘圈:与 fx()/clearFx() 是两套独立状态——
   * clearFx() 在每步开头清「临时」fx,这个圈要一直留到讲完(protocol.md「讲到哪、亮到哪」),
   * 不能被 clearFx() 误伤。同一个 target 重复调用是幂等的。
   */
  keepCircle(target: string): void;
  /** align:'top' 顶对齐(flow 的 do:focus);'ensure' 已经看得见就不动(reveal 跟随) */
  focus(target: string, opts?: { align?: 'top' | 'ensure' }): void;
  setZoom(z: number): void;
  getZoom(): number;
  addColumn(col: Column): void;
  /** 调试/截图脚本用:当前场景元素概览 */
  dumpElements(): Array<{ id: string; type: string; x: number; y: number; w: number; h: number }>;
}

interface FxItem extends FxRequest {
  uid: number;
}

interface BoardProps {
  script: BoardScript;
  revealed: ReadonlySet<string>;
  explore: { animationId: string; unlock: string[]; tasks: string[] } | null;
  /** handle.reveal 转成播放器的 setState(卡内行的可见性也靠它) */
  onReveal(target: string, opts: { instant: boolean }): void;
  onZoomChange(zoom: number): void;
}

/* ---------------------------- 元素构造 ---------------------------- */

let seedCounter = 1;

function baseElement(id: string, type: string, extra: Record<string, unknown>): SceneElement {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: INK,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: (seedCounter = (seedCounter * 48271) % 2147483647),
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  };
}

/** 手写体宽度估算(中文按 1 em,西文按 0.56 em),给列标题与马克笔定尺寸。 */
function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 255 ? fontSize : fontSize * 0.56;
  return w;
}

/** 不同卡型的卡纸样式:要点/小节标题无框,图与动画用虚线框,动手卡绿框。 */
function cardStyle(kind: string): Partial<SceneElement> {
  if (kind === 'heading' || kind === 'points') {
    return { strokeColor: 'transparent', backgroundColor: 'transparent', roughness: 0 };
  }
  if (kind === 'figure' || kind === 'animation') {
    return { strokeColor: '#6b7280', backgroundColor: '#ffffff', strokeStyle: 'dashed', roughness: 1.6 };
  }
  if (kind === 'explore') {
    return { strokeColor: '#059669', backgroundColor: '#ecfdf5', roughness: 2 };
  }
  return { strokeColor: INK, backgroundColor: PAPER, roughness: 2 };
}

/* ------------------------------ 组件 ------------------------------ */

export const ExcalidrawBoard = forwardRef<BoardApi, BoardProps>(function ExcalidrawBoard(
  { script, revealed, explore, onReveal, onZoomChange },
  ref,
) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const heights = useRef(new Map<string, number>());
  const parts = useRef(new Map<string, Map<string, Box>>());
  const [metricsVersion, bumpMetrics] = useReducer((n: number) => n + 1, 0);
  const [fxItems, setFxItems] = useState<FxItem[]>([]);
  const fxUid = useRef(0);
  /** emph:'circle' 留下的永久红圈,不受 clearFx() 影响(见 BoardApi.keepCircle 的注释) */
  const [keptCircles, setKeptCircles] = useState<ReadonlySet<string>>(new Set());
  const zoomRef = useRef(0.72);

  const cardById = useMemo(() => new Map(script.cards.map((c) => [c.id, c])), [script]);

  /** 某张卡此刻该不该在场景里 */
  const isCardVisible = useCallback(
    (card: Card, col: Column | undefined): boolean => {
      if (col?.phase === 'analysis') return true; // 审题列开讲前整列可见
      if (revealed.has(card.id)) return true;
      // 总结卡也可能是被逐条 reveal 出来的(协议的总结环节),这时卡本身没被 reveal 过
      if (card.kind === 'takeaways') return TAKEAWAY_GROUPS.some((g) => revealed.has(takeawayTarget(g, 0)));
      return false;
    },
    [revealed],
  );

  const visibleByColumn = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const col of script.columns) {
      const ids = script.cards.filter((c) => c.col === col.id && isCardVisible(c, col)).map((c) => c.id);
      if (col.phase === 'explore' && explore) ids.push(EXPLORE_CARD_ID);
      m.set(col.id, ids);
    }
    return m;
  }, [script, isCardVisible, explore]);

  const layout: BoardLayout = useMemo(
    // metricsVersion 变了就按新量到的高度重排
    () => layoutBoard(script.columns.map((c) => c.id), visibleByColumn, heights.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [script, visibleByColumn, metricsVersion],
  );

  /* ---------------------- 量高 / 量行偏移 ---------------------- */

  const onMeasure = useCallback((cardId: string, metrics: CardMetrics) => {
    const prevParts = parts.current.get(cardId);
    parts.current.set(cardId, metrics.parts);
    const prev = heights.current.get(cardId);
    const heightChanged = prev == null || Math.abs(prev - metrics.height) > 1;
    // 卡内多了/少了一行(fx 要按行定位)也得重算,否则红圈会停在旧位置
    const partsChanged = !prevParts || prevParts.size !== metrics.parts.size;
    if (heightChanged) heights.current.set(cardId, metrics.height);
    if (heightChanged || partsChanged) bumpMetrics();
  }, []);

  /** 目标(cardId 或卡内 lineId / takeaway 条目)在场景坐标里的盒子。 */
  const sceneBoxFor = useCallback(
    (target: string, snippet?: string): { x: number; y: number; w: number; h: number } | null => {
      const direct = layout.byCard.get(target);
      if (direct && !snippet) return { x: direct.x, y: direct.y, w: direct.w, h: direct.h };
      for (const [cardId, map] of parts.current) {
        const box = map.get(target);
        if (!box) continue;
        const place = layout.byCard.get(cardId);
        if (!place) continue;
        const sub = snippet ? snippetBox(cardId, target, snippet, zoomRef.current) : null;
        const use = sub ?? box;
        return { x: place.x + use.left, y: place.y + use.top, w: use.width, h: use.height };
      }
      return direct ? { x: direct.x, y: direct.y, w: direct.w, h: direct.h } : null;
    },
    [layout],
  );

  /* ------------------------- 场景元素 ------------------------- */

  const elements: SceneElement[] = useMemo(() => {
    const out: SceneElement[] = [];
    const fontSize = 28;

    script.columns.forEach((col, i) => {
      const place = layout.columns[i];
      if (!place) return;
      const w = textWidth(col.title, fontSize);
      // 马克笔在标题之前入列 → 画在字的下面
      out.push(
        baseElement(elementIds.colMark(col.id), 'rectangle', {
          x: place.x - 4,
          y: 18,
          width: w + 10,
          height: 15,
          strokeColor: 'transparent',
          backgroundColor: MARKER,
          fillStyle: 'solid',
          roughness: 0.6,
          opacity: 65,
        }),
      );
      out.push(
        baseElement(elementIds.colTitle(col.id), 'text', {
          x: place.x,
          y: 0,
          width: w,
          height: fontSize * 1.25,
          text: col.title,
          originalText: col.title,
          fontSize,
          fontFamily: FONT_FAMILY.Excalifont, // 中文自动回落到包内 Xiaolai
          textAlign: 'left',
          verticalAlign: 'top',
          containerId: null,
          autoResize: true,
          lineHeight: 1.25,
          strokeColor: PURPLE,
          roughness: 1,
        }),
      );
    });

    // 卡纸与 embeddable 分成两个元素:embeddable 全透明,卡纸是它下面的 rectangle。
    // 原因(实测):embeddable 的底色是在所有普通元素之后画的,红圈若排在 embeddable 之后
    // 仍会被卡纸盖掉;拆开之后顺序变成 卡纸 → 红圈 → 透明 embeddable,圈就露出来了。
    for (const place of layout.cards) {
      const kind = place.cardId === EXPLORE_CARD_ID ? 'explore' : (cardById.get(place.cardId)?.kind ?? 'board');
      out.push(
        baseElement(elementIds.paper(place.cardId), 'rectangle', {
          x: place.x,
          y: place.y,
          width: place.w,
          height: place.h,
          strokeWidth: 1.4,
          roundness: { type: 3 },
          ...cardStyle(kind),
        }),
      );
    }

    // fx 排在卡之后 → 画在卡纸之上;卡片 DOM 是透明的,所以圈看得见、字也压在圈上面
    for (const fx of fxItems) {
      const box = sceneBoxFor(fx.target, fx.snippet);
      if (!box) continue;
      const color = fx.color ?? '#dc2626';
      if (fx.kind === 'underline') {
        out.push(
          baseElement(elementIds.fx(fx.uid), 'line', {
            x: box.x - 4,
            y: box.y + box.h + 5,
            width: box.w + 8,
            height: 0,
            points: [
              [0, 0],
              [box.w + 8, 0],
            ],
            strokeColor: color,
            strokeWidth: 2,
            roughness: 2,
          }),
        );
      } else {
        const pad = fx.kind === 'pulse' ? 8 : 14;
        out.push(
          baseElement(elementIds.fx(fx.uid), 'ellipse', {
            x: box.x - pad,
            y: box.y - pad * 0.7,
            width: box.w + pad * 2,
            height: box.h + pad * 1.4,
            strokeColor: color,
            strokeWidth: 2,
            roughness: 2,
          }),
        );
      }
    }

    // emph:'circle' 的永久红圈——画法跟 fx 的 ellipse 一样,但这批不受 clearFx() 影响
    for (const target of keptCircles) {
      const box = sceneBoxFor(target);
      if (!box) continue;
      const pad = 14;
      out.push(
        baseElement(elementIds.keep(target), 'ellipse', {
          x: box.x - pad,
          y: box.y - pad * 0.7,
          width: box.w + pad * 2,
          height: box.h + pad * 1.4,
          strokeColor: '#dc2626',
          strokeWidth: 2,
          roughness: 2,
        }),
      );
    }

    // 最后才是承载卡片 DOM 的 embeddable:全透明,只负责把 React 卡片贴到画布上
    for (const place of layout.cards) {
      out.push(
        baseElement(elementIds.card(place.cardId), 'embeddable', {
          x: place.x,
          y: place.y,
          width: place.w,
          height: place.h,
          // link 是必须的:没有 link 的 embeddable 会被判成空嵌入,画一个「Empty Web-Embed」
          // 占位,renderEmbeddable 根本不会被调用(实测)
          link: cardLink(place.cardId),
          strokeColor: 'transparent',
          backgroundColor: 'transparent',
          strokeWidth: 0.5,
          roughness: 0,
          roundness: { type: 3 },
        }),
      );
    }

    return out;
  }, [script, layout, cardById, fxItems, keptCircles, sceneBoxFor]);

  useEffect(() => {
    api?.updateScene({ elements });
  }, [api, elements]);

  /* ----------------------------- 相机 ----------------------------- */

  /** Excalidraw:screen = (scene + scroll) * zoom。求「把场景点送到视口某像素位置」所需的 scroll。 */
  const scrollFor = (x: number, y: number, screenLeft: number, screenTop: number, k: number) => ({
    scrollX: screenLeft / k - x,
    scrollY: screenTop / k - y,
  });

  const glideRaf = useRef(0);
  const glideTo = useCallback(
    (scrollX: number, scrollY: number, animate = true) => {
      if (!api) return;
      cancelAnimationFrame(glideRaf.current);
      if (!animate) {
        api.updateScene({ appState: { scrollX, scrollY } });
        return;
      }
      const st = api.getAppState();
      const fromX = st.scrollX;
      const fromY = st.scrollY;
      const t0 = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / 420);
        const e = 1 - Math.pow(1 - p, 3);
        api.updateScene({
          appState: { scrollX: fromX + (scrollX - fromX) * e, scrollY: fromY + (scrollY - fromY) * e },
        });
        if (p < 1) glideRaf.current = requestAnimationFrame(step);
      };
      glideRaf.current = requestAnimationFrame(step);
    },
    [api],
  );

  useEffect(() => () => cancelAnimationFrame(glideRaf.current), []);

  // 首屏把场景原点摆到左上角(Excalidraw 默认自己居中,列一多就跑到视口外)
  const anchored = useRef(false);
  useEffect(() => {
    if (!api || anchored.current || !elements.length) return;
    anchored.current = true;
    const { scrollX, scrollY } = scrollFor(0, 0, MARGIN.left, MARGIN.top, zoomRef.current);
    api.updateScene({ appState: { scrollX, scrollY } });
  }, [api, elements.length]);

  /**
   * 开讲前的取景:缩放取到「审题列整列看得全 + 至少两列标题」,顶对齐。
   * 只在还没有任何卡浮现、且用户没自己动过画布时反复校准(卡量到真高后 layout 会变)。
   */
  const userAdjusted = useRef(false);
  useEffect(() => {
    if (!api || userAdjusted.current || revealed.size > 0) return;
    const first = script.columns[0];
    const firstPlace = layout.columns[0];
    if (!first || !firstPlace) return;
    const ids = visibleByColumn.get(first.id) ?? [];
    if (!ids.length || !ids.some((id) => heights.current.has(id))) return; // 等第一张卡量到高
    const st = api.getAppState();
    if (!st.height || !st.width) return;

    const contentH = firstPlace.bottom - CARD_GAP; // bottom 含尾部卡距
    const fitH = (st.height - MARGIN.top - 24) / Math.max(1, contentH);
    const fitW = (st.width - MARGIN.left - 24) / (COL_W * 2 + COL_GAP); // 至少两列
    const zoom = Math.max(0.4, Math.min(0.95, fitH, fitW));
    if (Math.abs(zoom - zoomRef.current) < 0.02) return;

    zoomRef.current = zoom;
    const { scrollX, scrollY } = scrollFor(0, 0, MARGIN.left, MARGIN.top, zoom);
    api.updateScene({ appState: { zoom: { value: zoom as never }, scrollX, scrollY } });
    onZoomChange(zoom);
  }, [api, layout, visibleByColumn, metricsVersion, revealed.size, script.columns, onZoomChange]);

  // 用户自己拖过/缩放过画布之后,别再自动改取景
  useEffect(() => {
    if (!api) return;
    return api.onPointerDown(() => {
      userAdjusted.current = true;
    });
  }, [api]);

  /* --------------------------- 对外接口 --------------------------- */

  useImperativeHandle(
    ref,
    (): BoardApi => ({
      reveal(target, opts) {
        onReveal(target, { instant: opts?.instant ?? false });
      },
      fx(req) {
        const uid = ++fxUid.current;
        setFxItems((prev) => [...prev.filter((f) => !(f.target === req.target && f.kind === req.kind)), { ...req, uid }]);
        if (req.kind === 'pulse') {
          // 画布元素没有 CSS 动画,pulse 用「短暂出现再撤掉」近似(已记 ISSUES.md)
          window.setTimeout(() => setFxItems((prev) => prev.filter((f) => f.uid !== uid)), 1400);
        }
      },
      clearFx() {
        setFxItems([]);
      },
      keepCircle(target) {
        setKeptCircles((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
      },
      focus(target, opts) {
        if (!api) return;
        let k = zoomRef.current;
        const colIdx = script.columns.findIndex((c) => c.id === target);
        let box: { x: number; y: number; w: number; h: number };
        let top = MARGIN.cardTop;
        if (colIdx >= 0) {
          const place = layout.columns[colIdx];
          if (!place) return;
          // 列:标题贴到工具栏下方(顶对齐,不居中)
          box = { x: place.x, y: 0, w: COL_W, h: place.bottom };
          top = MARGIN.top;
          // 审题列可能很长,把开讲前的缩放压得很小;讲到解题列时按这一列的高度把字放回可读的大小
          const st0 = api.getAppState();
          if (script.columns[colIdx].phase !== 'analysis' && !userAdjusted.current && st0.height) {
            const fit = (st0.height - MARGIN.top - 24) / Math.max(1, place.bottom - CARD_GAP);
            const want = Math.max(0.62, Math.min(0.9, fit));
            if (want > k + 0.02) {
              k = want;
              zoomRef.current = k;
              api.updateScene({ appState: { zoom: { value: k as never } } });
              onZoomChange(k);
            }
          }
        } else {
          const cardId = layout.byCard.has(target)
            ? target
            : [...parts.current.entries()].find(([, m]) => m.has(target))?.[0];
          const place = cardId ? layout.byCard.get(cardId) : undefined;
          if (!place) return;
          box = { x: place.x, y: place.y, w: place.w, h: place.h };
        }
        const st = api.getAppState();
        if (opts?.align === 'ensure') {
          // 已经舒舒服服在视野里就别晃(卡片逐张浮现时跟随用)
          const l = (box.x + st.scrollX) * k;
          const t = (box.y + st.scrollY) * k;
          if (l >= 24 && l + box.w * k <= st.width - 16 && t >= 16 && t + box.h * k <= st.height - 16) return;
        }
        const { scrollX, scrollY } = scrollFor(box.x, box.y, MARGIN.left, top, k);
        glideTo(scrollX, scrollY);
      },
      setZoom(z) {
        const value = Math.min(2, Math.max(0.25, z));
        userAdjusted.current = true;
        zoomRef.current = value;
        api?.updateScene({ appState: { zoom: { value: value as never } } });
        onZoomChange(value);
      },
      getZoom() {
        return zoomRef.current;
      },
      addColumn() {
        // 列来自剧本(script.columns),这里只需要触发一次重排
        bumpMetrics();
      },
      dumpElements() {
        return (api?.getSceneElements() ?? []).map((el) => ({
          id: el.id,
          type: el.type,
          x: Math.round(el.x),
          y: Math.round(el.y),
          w: Math.round(el.width),
          h: Math.round(el.height),
        }));
      },
    }),
  );

  /* -------------------------- renderEmbeddable -------------------------- */

  const renderEmbeddable = useCallback(
    (element: { id: string; link: string | null }) => {
      const cardId = cardIdFromElement(element);
      if (!cardId) return <div />;
      if (cardId === EXPLORE_CARD_ID) {
        return (
          <CardHost cardId={cardId} onMeasure={onMeasure}>
            <ExploreCard />
          </CardHost>
        );
      }
      const card = cardById.get(cardId);
      if (!card) return <div />;
      return (
        <CardHost cardId={cardId} onMeasure={onMeasure}>
          <CardView card={card} />
        </CardHost>
      );
    },
    [cardById, onMeasure],
  );

  return (
    <div className="stage">
      <Excalidraw
        excalidrawAPI={setApi}
        viewModeEnabled
        theme="light"
        initialData={{
          appState: {
            viewBackgroundColor: 'transparent',
            zoom: { value: zoomRef.current as never },
            scrollX: 40,
            scrollY: 60,
          },
          scrollToContent: false,
        }}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: false,
            toggleTheme: false,
          },
        }}
        validateEmbeddable={() => true}
        renderEmbeddable={renderEmbeddable as never}
        onChange={(_els, appState) => {
          if (Math.abs(appState.zoom.value - zoomRef.current) > 0.001) {
            zoomRef.current = appState.zoom.value;
            onZoomChange(appState.zoom.value);
          }
        }}
      />
    </div>
  );
});

/* ---------------------------- 子串定位 ---------------------------- */

const snippetCache = new Map<string, Box>();

/** fx 带 snippet 时圈到那个子串:在活着的卡片 DOM 里用 Range 量,换算回布局像素。 */
function snippetBox(cardId: string, target: string, snippet: string, zoom: number): Box | null {
  const key = `${cardId}::${target}::${snippet}`;
  const root = document.querySelector<HTMLElement>(`[data-card-root="${CSS.escape(cardId)}"]`);
  const el = root?.querySelector<HTMLElement>(`[data-fx-target="${CSS.escape(target)}"]`);
  if (!root || !el) return snippetCache.get(key) ?? null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const idx = (node.textContent ?? '').indexOf(snippet);
    if (idx < 0) continue;
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + snippet.length);
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const base = root.getBoundingClientRect();
    const k = zoom || 1;
    const box: Box = {
      left: (r.left - base.left) / k,
      top: (r.top - base.top) / k,
      width: r.width / k,
      height: r.height / k,
    };
    snippetCache.set(key, box);
    return box;
  }
  return snippetCache.get(key) ?? null;
}
