/**
 * markdown → HTML(表格 / 列表 / 粗斜体 / 行内码 / ==高亮==)。
 * 照搬 OpenHyperKnow board/cards.tsx 的 mdToHtml,只保留白板卡片用得到的部分。
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>');
}

export function mdToHtml(md: string): string {
  const lines = escapeHtml(md).split('\n');
  const out: string[] = [];
  let inList: 'ul' | 'ol' | null = null;
  let inTable = false;
  let rowIdx = 0;

  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
      rowIdx = 0;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (/^\|.*\|$/.test(line)) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.every((c) => /^[-: ]+$/.test(c))) continue; // 分隔行
      if (!inTable) {
        out.push('<table class="board-table"><tbody>');
        inTable = true;
        rowIdx = 0;
      }
      const tag = rowIdx === 0 ? 'th' : 'td';
      out.push(`<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`);
      rowIdx++;
      continue;
    }
    closeTable();

    if (/^(\d+)\.\s+/.test(line)) {
      if (inList !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = 'ol';
      }
      out.push(`<li>${inline(line.replace(/^(\d+)\.\s+/, ''))}</li>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (inList !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = 'ul';
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
    } else {
      closeList();
      if (line) out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  closeTable();
  return out.join('\n');
}
