/** Tiny markdown renderer, tuned for the AI reply bubble on iOS 10 WebKit. */

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text: string): string {
  let s = esc(text);
  // inline code first (protect content)
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, function (_m, code) {
    codes.push('<code>' + code + '</code>');
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  s = s.replace(/\u0000(\d+)\u0000/g, function (_m, idx) {
    return codes[parseInt(idx, 10)];
  });
  return s;
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
      /^\s*[-*+]\s+/.test(line) ||
      /^\s*\d+[.)]\s+/.test(line) ||
      /^\s*>\s?/.test(line) ||
      /^\s*(---|\*\*\*|___)\s*$/.test(line)
    );
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
      out.push('<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' + esc(buf.join('\n')) + '</code></pre>');
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
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushPara();
      out.push('<hr>');
      i++;
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + inline(buf.join('\n')).replace(/\n/g, '<br>') + '</blockquote>');
      continue;
    }

    // lists
    const bullet = /^\s*[-*+]\s+/;
    const ordered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || ordered.test(line)) {
      flushPara();
      const isOrdered = ordered.test(line);
      const re = isOrdered ? ordered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(lines[i].replace(re, ''));
        i++;
        // continuation lines
        while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
      }
      const tag = isOrdered ? 'ol' : 'ul';
      out.push('<' + tag + '>' + items.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</' + tag + '>');
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