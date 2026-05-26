'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
  color?: string;
  size?: number;
  center?: boolean;
}

export default function MarkdownContent({
  content,
  color = '#e5e7eb',
  size = 16,
  center = false,
}: Props) {
  return (
    <div
      style={{
        color,
        fontSize: `${size}px`,
        lineHeight: 1.7,
        textAlign: center ? 'center' : 'left',
        wordBreak: 'break-word',
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p style={{ margin: '0 0 12px', lineHeight: 1.7 }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ fontWeight: 800, color: '#ffffff' }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ fontStyle: 'italic', color: '#d1d5db' }}>{children}</em>
          ),
          h1: ({ children }) => (
            <h1 style={{ fontSize: '1.5em', fontWeight: 900, margin: '0 0 12px', color: '#fff' }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontSize: '1.3em', fontWeight: 800, margin: '0 0 10px', color: '#fff' }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontSize: '1.15em', fontWeight: 700, margin: '0 0 8px', color: '#fff' }}>
              {children}
            </h3>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '0 0 12px', paddingLeft: '20px' }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '0 0 12px', paddingLeft: '20px' }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ marginBottom: '6px' }}>{children}</li>
          ),
          code: ({ children }) => (
            <code
              style={{
                background: 'rgba(255,255,255,0.12)',
                padding: '2px 6px',
                borderRadius: '6px',
                fontSize: '0.92em',
                fontFamily: 'monospace',
                color: '#f9fafb',
              }}
            >
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: '0 0 12px',
                padding: '10px 14px',
                borderLeft: '3px solid rgba(255,255,255,0.35)',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: '8px',
                color: '#e5e7eb',
              }}
            >
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr
              style={{
                border: 'none',
                borderTop: '1px solid rgba(255,255,255,0.15)',
                margin: '14px 0',
              }}
            />
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#93c5fd', textDecoration: 'underline' }}
            >
              {children}
            </a>
          ),
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}