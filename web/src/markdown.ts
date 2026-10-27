/**
 * Tiny GFM markdown renderer, tuned for the AI reply bubble on iOS 10 WebKit.
 *
 * Supported blocks: fenced code, headings, hr, blockquote, pipe tables (with
 * alignment), bullet/ordered lists (one nesting level, task items), paragraphs.
 * Supported inline: inline code, bold, italic, strikethrough, links, bare URLs,
 * images (rendered as links — no remote image loading on this device).
 * Raw HTML is always escaped, never interpreted.
 */

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Emphasis only — safe to run on an already-escaped label. */
function emph(text: string): string {
  let s = text;
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

const TOKEN = '\u0000';

/** Inline code. An absolute URL keeps its code chrome and also becomes a link. */
function codeSpan(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\/\S+$/.test(trimmed)) {
    return '<code><a href="' + trimmed + '" target="_blank">' + value + '</a></code>';
  }
  return '<code>' + value + '</code>';
}

function inline(text: string): string {
  const tokens: string[] = [];
  function stash(html: string): string {
    tokens.push(html);
    return TOKEN + (tokens.length - 1) + TOKEN;
  }

  let s = esc(text);

  // inline code first: its content must not be parsed as markdown
  s = s.replace(/`([^`]+)`/g, function (_m, code: string) {
    return stash(codeSpan(code));
  });

  // images: link instead of loading a remote bitmap (iPad 4, untrusted URLs)
  s = s.replace(/!\[([^\]\n]*)\]\((https?:[^)\s]+)\)/g, function (_m, alt: string, url: string) {
    return stash('<a href="' + url + '" target="_blank">[' + (alt || '图片') + ']</a>');
  });

  // markdown links
  s = s.replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, function (_m, label: string, url: string) {
    return stash('<a href="' + url + '" target="_blank">' + emph(label) + '</a>');
  });

  s = emph(s);

  // bare URLs / www. outside links and code
  s = s.replace(/(?:https?:\/\/|www\.)[^\s<>"'\u3000\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f\uff08\uff09]+/g,
    function (raw: string) {
      let url = raw;
      // trailing punctuation / wrapping parens belong to the sentence, not the URL
      const tail: string[] = [];
      while (/[.,;:!?'"]$/.test(url)) {
        tail.unshift(url.slice(-1));
        url = url.slice(0, -1);
      }
      while (url.charAt(url.length - 1) === ')' &&
             (url.split('(').length - 1) < (url.split(')').length - 1)) {
        tail.unshift(')');
        url = url.slice(0, -1);
      }
      if (!url) {
        return raw;
      }
      let href = url;
      if (/^www\./i.test(href)) {
        href = 'http://' + href;
      }
      return '<a href="' + href + '" target="_blank">' + url + '</a>' + tail.join('');
    });

  return s.replace(/\u0000(\d+)\u0000/g, function (_m, idx: string) {
    return tokens[parseInt(idx, 10)];
  });
}

/** `\|` inside a cell must not split the row. */
const CELL_PIPE = '\u0001';

function splitRow(line: string): string[] {
  let s = String(line == null ? '' : line).trim();
  if (s.charAt(0) === '|') {
    s = s.slice(1);
  }
  if (s.charAt(s.length - 1) === '|') {
    s = s.slice(0, -1);
  }
  s = s.split('\\|').join(CELL_PIPE);
  const cells = s.split('|');
  for (let i = 0; i < cells.length; i++) {
    cells[i] = cells[i].split(CELL_PIPE).join('|').trim();
  }
  return cells;
}

/** `|---|:--:|` separator row that makes the previous row a table header. */
function isTableSeparator(line: string): boolean {
  if (!line || line.indexOf('-') < 0) {
    return false;
  }
  const cells = splitRow(line);
  if (!cells.length) {
    return false;
  }
  for (let i = 0; i < cells.length; i++) {
    if (!/^:?-{1,}:?$/.test(cells[i])) {
      return false;
    }
  }
  return true;
}

function tableAlign(cell: string): string {
  if (/^:.*:$/.test(cell)) {
    return 'center';
  }
  if (/^:/.test(cell)) {
    return 'left';
  }
  if (/:$/.test(cell)) {
    return 'right';
  }
  return '';
}

interface ListMark {
  indent: number;
  ordered: boolean;
  num: number;
  text: string;
}

function listMark(line: string): ListMark | null {
  const bullet = /^([ \t]*)[-*+]\s+(.*)$/.exec(line);
  if (bullet) {
    return { indent: bullet[1].length, ordered: false, num: 0, text: bullet[2] };
  }
  const ordered = /^([ \t]*)(\d+)[.)]\s+(.*)$/.exec(line);
  if (ordered) {
    return { indent: ordered[1].length, ordered: true, num: parseInt(ordered[2], 10), text: ordered[3] };
  }
  return null;
}

/** Task list item (`- [ ]` / `- [x]`) or ordinary inline content. */
function listItemHtml(text: string): string {
  const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
  if (task) {
    const done = task[1].toLowerCase() === 'x';
    return '<span class="task-box' + (done ? ' is-done' : '') + '"></span>' + inline(task[2]);
  }
  return inline(text);
}

export function renderMarkdown(src: string): string {
  const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  function flushPara(): void {
    if (para.length) {
      out.push('<p>' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>');
      para = [];
    }
  }

  function startsBlock(line: string): boolean {
    return (
      /^```/.test(line) ||
      /^#{1,6}\s+/.test(line) ||
      /^[ \t]*[-*+]\s+/.test(line) ||
      /^[ \t]*\d+[.)]\s+/.test(line) ||
      /^[ \t]*>\s?/.test(line) ||
      /^[ \t]*(---|\*\*\*|___)\s*$/.test(line)
    );
  }

  /** One list (and its nested children); advances the shared cursor. */
  function renderList(cursor: { i: number }, baseIndent: number, depth: number): string {
    const first = listMark(lines[cursor.i]);
    if (!first) {
      return '';
    }
    const ordered = first.ordered;
    const startNumber = first.num;
    const items: string[] = [];
    while (cursor.i < lines.length) {
      const mark = listMark(lines[cursor.i]);
      if (!mark || mark.indent !== baseIndent || mark.ordered !== ordered) {
        break;
      }
      cursor.i++;
      let text = mark.text;

      // continuation lines that are not a new item or block
      while (cursor.i < lines.length && lines[cursor.i].trim() && !listMark(lines[cursor.i]) &&
             !startsBlock(lines[cursor.i])) {
        text += ' ' + lines[cursor.i].trim();
        cursor.i++;
      }

      let nested = '';
      const next = cursor.i < lines.length ? listMark(lines[cursor.i]) : null;
      if (next && next.indent > baseIndent && depth < 1) {
        nested = renderList(cursor, next.indent, depth + 1);
      }
      items.push('<li>' + listItemHtml(text) + nested + '</li>');

      // loose list: blank lines between items of the same list
      if (cursor.i < lines.length && !lines[cursor.i].trim()) {
        let j = cursor.i;
        while (j < lines.length && !lines[j].trim()) {
          j++;
        }
        const after = j < lines.length ? listMark(lines[j]) : null;
        if (after && after.indent === baseIndent && after.ordered === ordered) {
          cursor.i = j;
        }
      }
    }
    const tag = ordered ? 'ol' : 'ul';
    const start = ordered && startNumber > 1 ? ' start="' + startNumber + '"' : '';
    return '<' + tag + start + '>' + items.join('') + '</' + tag + '>';
  }

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line)) {
      flushPara();
      const lang = line.replace(/^```/, '').trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push('<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' +
               esc(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = Math.min(Math.max(h[1].length, 2), 4);
      out.push('<h' + level + '>' + inline(h[2]) + '</h' + level + '>');
      i++;
      continue;
    }

    // horizontal rule
    if (/^[ \t]*(---|\*\*\*|___)\s*$/.test(line)) {
      flushPara();
      out.push('<hr>');
      i++;
      continue;
    }

    // blockquote
    if (/^[ \t]*>\s?/.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^[ \t]*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^[ \t]*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + inline(buf.join('\n')).replace(/\n/g, '<br>') + '</blockquote>');
      continue;
    }

    // pipe table: header row + separator row + body rows
    if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(tableAlign);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const row = lines[i];
        if (!row.trim() || row.indexOf('|') < 0 || isTableSeparator(row)) {
          break;
        }
        rows.push(splitRow(row));
        i++;
      }
      const wide = header.length >= 4 ? ' is-wide' : '';
      let html = '<div class="table-wrap' + wide + '"><table><thead><tr>';
      for (let c = 0; c < header.length; c++) {
        const style = aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '';
        html += '<th' + style + '>' + inline(header[c]) + '</th>';
      }
      html += '</tr></thead>';
      if (rows.length) {
        html += '<tbody>';
        for (let r = 0; r < rows.length; r++) {
          html += '<tr>';
          for (let c = 0; c < header.length; c++) {
            const style = aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '';
            html += '<td' + style + '>' + inline(rows[r][c] || '') + '</td>';
          }
          html += '</tr>';
        }
        html += '</tbody>';
      }
      html += '</table></div>';
      out.push(html);
      continue;
    }

    // lists
    const mark = listMark(line);
    if (mark) {
      flushPara();
      const cursor = { i: i };
      out.push(renderList(cursor, mark.indent, 0));
      i = cursor.i;
      continue;
    }

    // blank line separates paragraphs
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return out.join('');
}