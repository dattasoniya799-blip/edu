/**
 * 口播:预渲染 clip(<audio>,语速走 playbackRate)优先,
 * clip 缺失或 clip.text 与实际文本不一致时回退浏览器 Web Speech(zh-CN)。
 */
import type { BoardScript } from '../types';
import { pickClip } from './audio-keys';
import type { SayRequest, SpeechHandle } from './flow';

/** 静音 / 无 TTS 时按字数估时长,保证讲解节奏不塌。 */
export function estimateMs(text: string, rate: number): number {
  const base = 260 + text.length * 175;
  return Math.max(400, Math.round(base / Math.max(0.5, rate)));
}

function timedHandle(ms: number): SpeechHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let remaining = ms;
  let startedAt = Date.now();
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const arm = () => {
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = null;
      finish();
    }, remaining);
  };
  arm();
  const disarm = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    }
  };
  return {
    done,
    cancel() {
      disarm();
      finish();
    },
    pause: disarm,
    resume() {
      if (!timer) arm();
    },
  };
}

export class Speaker {
  rate = 1;
  muted = false;
  private current: { el?: HTMLAudioElement; utter?: SpeechSynthesisUtterance } | null = null;

  constructor(private readonly getAudio: () => BoardScript['audio'] | undefined) {}

  setRate(rate: number): void {
    this.rate = rate;
    if (this.current?.el) this.current.el.playbackRate = rate;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stopAll();
  }

  stopAll(): void {
    if (this.current?.el) {
      this.current.el.pause();
      this.current.el.src = '';
    }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.current = null;
  }

  speak(req: SayRequest): SpeechHandle {
    if (this.muted) return timedHandle(estimateMs(req.text, this.rate));
    const clip = pickClip(this.getAudio(), req.key, req.text);
    if (clip) {
      const handle = this.playClip(clip.src);
      if (handle) return handle;
    }
    return this.speakBrowser(req.text);
  }

  /** clip 命中:<audio> 播放,语速跟 playbackRate;加载失败回退 Web Speech。 */
  private playClip(src: string): SpeechHandle | null {
    if (typeof Audio === 'undefined') return null;
    const el = new Audio(src);
    el.playbackRate = this.rate;
    this.current = { el };
    let settled = false;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
    });
    el.addEventListener('ended', finish);
    el.addEventListener('error', finish);
    void el.play().catch(finish);
    return {
      done,
      cancel() {
        el.pause();
        finish();
      },
      pause() {
        el.pause();
      },
      resume() {
        if (!settled) void el.play().catch(finish);
      },
    };
  }

  private speakBrowser(text: string): SpeechHandle {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
      return timedHandle(estimateMs(text, this.rate));
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = this.rate;
    this.current = { utter };
    let settled = false;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        resolve();
      };
    });
    // Web Speech 偶尔不回 end(Chrome 长文本);按估时兜底,不让讲解卡死。
    const guard = setTimeout(finish, estimateMs(text, this.rate) * 2 + 4000);
    utter.onend = finish;
    utter.onerror = finish;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
    return {
      done,
      cancel() {
        speechSynthesis.cancel();
        finish();
      },
      pause() {
        speechSynthesis.pause();
      },
      resume() {
        speechSynthesis.resume();
      },
    };
  }
}
