'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
  temaColor?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: '' };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    this.setState({ errorInfo: info.componentStack ?? '' });
    // Log en consola con contexto
    console.error(`[ErrorBoundary:${this.props.name ?? 'unknown'}]`, error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: '' });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    const color = this.props.temaColor ?? '#f5c842';

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        minHeight: '120px',
        background: 'rgba(239,68,68,0.06)',
        border: '1px solid rgba(239,68,68,0.2)',
        borderRadius: '12px',
        gap: '12px',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        <div style={{ fontSize: '28px' }}>⚠️</div>
        <div style={{ textAlign: 'center' }}>
          <p style={{
            margin: 0,
            fontWeight: 700,
            fontSize: '14px',
            color: '#ef4444',
          }}>
            {this.props.name ? `Error en ${this.props.name}` : 'Algo salió mal'}
          </p>
          {this.state.error && (
            <p style={{
              margin: '4px 0 0 0',
              fontSize: '11px',
              color: '#9ca3af',
              maxWidth: '320px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {this.state.error.message}
            </p>
          )}
        </div>
        <button
          onClick={this.handleReset}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: 'none',
            background: color,
            color: '#000',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }
}

// ─── Versión simplificada para wrapear secciones pequeñas ─────────────────
export class SilentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[SilentErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
