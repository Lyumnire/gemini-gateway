/**
 * MarkdownRenderer — 轻量 Markdown 渲染器（浅色主题）。
 */

import { memo, useMemo } from 'react';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    );
}

function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let inList = false;
  let listType = '';

  for (const line of lines) {
    // ---- Code Block ----
    if (line.startsWith('```')) {
      if (inCode) {
        const langLabel = codeLang ? `<div style="position:absolute;top:8px;right:12px;font-size:10px;opacity:0.3;text-transform:uppercase">${escapeHtml(codeLang)}</div>` : '';
        html.push(`<pre style="position:relative">${langLabel}<code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCode = false;
        codeLang = '';
      } else {
        if (inList) { html.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCode) { codeLines.push(line); continue; }

    const t = line.trim();

    // ---- Empty ----
    if (!t) {
      if (inList) { html.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      continue;
    }

    // ---- Heading ----
    const hm = t.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      if (inList) { html.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      const lv = hm[1].length;
      const cls = lv <= 2 ? 'font-semibold text-gray-900 mt-4 mb-2' : 'font-medium text-gray-800 mt-3 mb-1';
      html.push(`<h${lv} class="${cls}">${renderInline(escapeHtml(hm[2]))}</h${lv}>`);
      continue;
    }

    // ---- Unordered List ----
    if (/^[-*]\s+/.test(t)) {
      if (!inList) { html.push('<ul>'); inList = true; listType = 'ul'; }
      html.push(`<li>${renderInline(escapeHtml(t.replace(/^[-*]\s+/, '')))}</li>`);
      continue;
    }

    // ---- Ordered List ----
    if (/^\d+\.\s+/.test(t)) {
      if (!inList) { html.push('<ol>'); inList = true; listType = 'ol'; }
      html.push(`<li>${renderInline(escapeHtml(t.replace(/^\d+\.\s+/, '')))}</li>`);
      continue;
    }

    // ---- Paragraph ----
    if (inList) { html.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
    html.push(`<p>${renderInline(escapeHtml(t))}</p>`);
  }

  if (inList) html.push(listType === 'ul' ? '</ul>' : '</ol>');
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);

  return html.join('\n');
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  const html = useMemo(() => markdownToHtml(content), [content]);
  return <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />;
});
