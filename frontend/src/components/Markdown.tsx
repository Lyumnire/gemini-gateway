import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { CheckIcon, CopyIcon } from './icons';

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);

  let lang = '';
  let text = '';
  if (Array.isArray(children) && children.length > 0) {
    const codeEl = children[0];
    if (codeEl && typeof codeEl === 'object' && 'props' in codeEl) {
      const props = codeEl.props as { className?: string; children?: unknown };
      lang = (props.className ?? '').replace('language-', '');
      text = String(props.children ?? '');
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  };

  return (
    <div className="group/code relative my-3 overflow-hidden rounded-xl border border-slate-200 bg-[#0d1117] dark:border-slate-700">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[11px] font-medium tracking-wide text-slate-400">{lang || 'code'}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
        >
          {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown-body prose prose-sm dark:prose-invert max-w-none prose-pre:bg-transparent prose-pre:p-0 prose-code:before:content-[''] prose-code:after:content-[''] prose-p:leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: (props) => <CodeBlock>{props.children}</CodeBlock>,
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          img: (props) => (
            <img {...props} loading="lazy" className="max-w-full rounded-lg" />
          ),
          table: (props) => (
            <div className="overflow-x-auto">
              <table {...props} />
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
