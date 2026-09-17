/** 百炼 cosyvoice-v3-flash 的系统女声(普通话,不做复刻);默认龙小淳。 */
export interface VoiceInfo {
  id: string
  name: string
  trait: string
}

export const VOICES: VoiceInfo[] = [
  { id: 'longxiaochun_v3', name: '龙小淳', trait: '知性积极' },
  { id: 'longanwen_v3', name: '龙安温', trait: '优雅知性' },
  { id: 'longxiaoxia_v3', name: '龙小夏', trait: '沉稳权威' },
  { id: 'longyingling_v3', name: '龙应聆', trait: '温和共情' }
]

export function findVoice(id: string): VoiceInfo | undefined {
  return VOICES.find((v) => v.id === id)
}
