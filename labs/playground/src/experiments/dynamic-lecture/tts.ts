/**
 * TTS 供应商接口:narration 是剧本字段,TTS 只是"读讲稿的人",可整体替换。
 *
 * 浏览器占位实现的坑与对策(审查修复):
 * - 声音列表异步加载 → voiceschanged 监听 + dispose 时移除;
 * - 需要用户手势解锁 → 由"开始上课"按钮触发首次 speak;
 * - onend 不可靠 → 看门狗(260ms/字 + 1.5s)兜底,讲稿卡住不阻塞连播;
 * - cancel 后立刻 speak 会被吞 → 延迟 80ms;该延迟定时器必须能被 stop() 取消,
 *   否则快速翻步/退出全屏后叠播(P0-2);用代次号 gen 作废过期请求。
 */

export interface TtsProvider {
  readonly name: string;
  readonly available: boolean;
  /** 朗读一段讲稿;resolve = 播完或被取消(绝不 reject、绝不悬挂) */
  speak(text: string): Promise<void>;
  stop(): void;
  setRate(rate: number): void;
  /** 是否有中文人声可用(用于无声兜底提示) */
  hasChineseVoice(): boolean;
  dispose(): void;
}

/** 浏览器语音占位(评审版默认) */
export class BrowserTts implements TtsProvider {
  readonly name = '浏览器语音(占位)';
  private cachedVoice: SpeechSynthesisVoice | null = null;
  private gen = 0;
  private pendingTimer = 0;
  private finishCurrent: (() => void) | null = null;
  private rate = 1.05;
  private readonly onVoicesChanged = () => {
    this.cachedVoice = null;
    this.pickVoice();
  };

  constructor() {
    if (this.available) {
      this.pickVoice();
      window.speechSynthesis.addEventListener?.('voiceschanged', this.onVoicesChanged);
    }
  }

  get available(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  hasChineseVoice(): boolean {
    if (!this.available) return false;
    return this.pickVoice() !== null;
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    if (this.cachedVoice) return this.cachedVoice;
    const voices = window.speechSynthesis.getVoices();
    this.cachedVoice =
      voices.find((v) => v.lang === 'zh-CN' && /Tingting|Xiaoxiao|Mei|婷|晓/.test(v.name)) ??
      voices.find((v) => v.lang === 'zh-CN') ??
      voices.find((v) => v.lang.startsWith('zh')) ??
      null;
    return this.cachedVoice;
  }

  speak(text: string): Promise<void> {
    if (!this.available) return Promise.resolve();
    this.stop();
    const myGen = ++this.gen;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(watchdog);
        if (this.finishCurrent === finish) this.finishCurrent = null;
        resolve();
      };
      this.finishCurrent = finish;
      const watchdog = window.setTimeout(finish, Math.max(4000, text.length * 260 + 1500));

      // cancel 后立刻 speak 在部分浏览器会被吞,隔一拍再说;期间若被 stop() 作废则直接收尾
      this.pendingTimer = window.setTimeout(() => {
        if (done || myGen !== this.gen) return finish();
        const u = new SpeechSynthesisUtterance(text);
        const voice = this.pickVoice();
        if (voice) u.voice = voice;
        u.lang = 'zh-CN';
        u.rate = this.rate;
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
      }, 80);
    });
  }

  stop(): void {
    if (!this.available) return;
    this.gen++;
    window.clearTimeout(this.pendingTimer);
    this.finishCurrent?.(); // 立刻 settle 上一段的 promise,不留悬挂
    window.speechSynthesis.cancel();
  }

  dispose(): void {
    this.stop();
    if (this.available) {
      window.speechSynthesis.removeEventListener?.('voiceschanged', this.onVoicesChanged);
    }
  }
}

/** 预生成音频供应商:剧本步骤携带 audioUrl 时使用(接真 TTS 后的生产形态) */
export class PregeneratedAudioTts implements TtsProvider {
  readonly name = '预生成音频';
  readonly available = true;
  private audio: HTMLAudioElement | null = null;
  private finishCurrent: (() => void) | null = null;
  private rate = 1;
  constructor(private readonly urlOf: (text: string) => string | undefined) {}

  setRate(rate: number): void {
    this.rate = rate;
    if (this.audio) this.audio.playbackRate = rate;
  }

  hasChineseVoice(): boolean {
    return true;
  }

  speak(text: string): Promise<void> {
    this.stop();
    const url = this.urlOf(text);
    if (!url) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (this.finishCurrent === finish) this.finishCurrent = null;
        resolve();
      };
      this.finishCurrent = finish;
      const audio = new Audio(url);
      audio.playbackRate = this.rate;
      audio.onended = finish;
      audio.onerror = finish;
      this.audio = audio;
      void audio.play().catch(finish);
    });
  }

  stop(): void {
    this.audio?.pause();
    this.audio = null;
    this.finishCurrent?.();
  }

  dispose(): void {
    this.stop();
  }
}
