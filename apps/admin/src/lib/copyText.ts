/**
 * 健壮的剪贴板复制工具(管理端所有「复制」交互统一走这里):
 * 1) 优先 navigator.clipboard.writeText —— 仅安全上下文可用(https / localhost);
 *    http://<局域网IP> 访问时 navigator.clipboard 为 undefined,Safari 在权限受限时也会 reject;
 * 2) 失败或不可用时回退 textarea + document.execCommand('copy')(不要求安全上下文);
 * 3) 两条路径都失败返回 false,由调用方提示用户手动选中文本复制(切勿在失败时提示「已复制」)。
 */
export async function copyText(text: string): Promise<boolean> {
  // 路径一:异步 Clipboard API(存在才尝试;非安全上下文下整个 navigator.clipboard 不存在)
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒 / Safari 手势校验失败等 —— 落入回退路径,不直接报错
    }
  }
  return fallbackCopy(text);
}

/** 路径二:隐藏 textarea + execCommand('copy') 兜底(同步,需在用户手势内调用) */
function fallbackCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const ta = document.createElement('textarea');
  try {
    ta.value = text;
    // readonly + 移出视口:避免 iOS 弹键盘、页面滚动跳动
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    // iOS Safari 的 select() 不生效,需显式设置选区
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    if (ta.parentNode) ta.parentNode.removeChild(ta);
  }
}
