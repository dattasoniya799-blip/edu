import { describe, expect, it } from 'vitest';
import {
  cardSpeechKey,
  lineSpeechKey,
  pickClip,
  stepFlowKey,
  takeawayKey,
  takeawaySpeechText,
} from './audio-keys';
import type { BoardScript } from '../types';

describe('音频 key 推导(protocol.md「音频 key」)', () => {
  it('steps.<stepId>.flow.<i> 用 flow 数组下标,不是 say 的序号', () => {
    expect(stepFlowKey('s2', 0)).toBe('steps.s2.flow.0');
    expect(stepFlowKey('s2', 7)).toBe('steps.s2.flow.7');
  });

  it('cards.<cardId>.lines.<lineId> 给 formula 行的 speech', () => {
    expect(lineSpeechKey('k1_board', 'l1b')).toBe('cards.k1_board.lines.l1b');
  });

  it('cards.<cardId>.speech 给 table 卡', () => {
    expect(cardSpeechKey('k2_table')).toBe('cards.k2_table.speech');
  });

  it('takeaways.<group>.<i> 给总结四组', () => {
    expect(takeawayKey('knowledge', 0)).toBe('takeaways.knowledge.0');
    expect(takeawayKey('variants', 2)).toBe('takeaways.variants.2');
  });
});

describe('总结条目的口播文本', () => {
  it('去掉【】,首条前加组名', () => {
    expect(takeawaySpeechText('knowledge', '水平面上【压力等于重力】', 0)).toBe('核心知识点。水平面上压力等于重力');
    expect(takeawaySpeechText('pitfalls', '面积单位【10⁻³ m²】别抄错', 1)).toBe('面积单位10⁻³ m²别抄错');
  });

  it('四个组名前缀与协议一致', () => {
    expect(takeawaySpeechText('pitfalls', 'x', 0)).toBe('考点与易错。x');
    expect(takeawaySpeechText('methods', 'x', 0)).toBe('方法与技巧。x');
    expect(takeawaySpeechText('variants', 'x', 0)).toBe('举一反三。x');
  });
});

describe('clip 文本比对回退', () => {
  const audio: BoardScript['audio'] = {
    voice: { provider: 'bailian', voiceId: 'longxiaochun_v3', name: '龙小淳' },
    clips: {
      'steps.s1.flow.1': { text: '先看第(1)问。', src: '/assets/x/audio/steps.s1.flow.1.mp3' },
      'steps.s1.flow.9': { text: '没有 src', src: '' },
    },
  };

  it('key 命中且文本逐字相同 → 用预渲染音频', () => {
    expect(pickClip(audio, 'steps.s1.flow.1', '先看第(1)问。')?.src).toContain('.mp3');
  });

  it('文本对不上 → null(播放器回退 Web Speech)', () => {
    expect(pickClip(audio, 'steps.s1.flow.1', '先看第(1)问')).toBeNull();
  });

  it('key 不存在 / 没有 audio → null', () => {
    expect(pickClip(audio, 'steps.s9.flow.0', '随便')).toBeNull();
    expect(pickClip(undefined, 'steps.s1.flow.1', '先看第(1)问。')).toBeNull();
  });

  it('clip 没有 src → null', () => {
    expect(pickClip(audio, 'steps.s1.flow.9', '没有 src')).toBeNull();
  });
});
