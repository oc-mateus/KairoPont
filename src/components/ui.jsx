import { useState } from 'react';

export function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  if (!isOpen) return null;

  const sizeClass = size === 'lg' ? 'style' : '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={size === 'lg' ? { maxWidth: '700px' } : {}}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirmar', danger = false }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-body">
          <div className="confirm-dialog">
            <div className="confirm-icon">{danger ? '⚠️' : '❓'}</div>
            <h3 className="confirm-title">{title}</h3>
            <p className="confirm-text">{message}</p>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
              <button
                className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => { onConfirm(); onClose(); }}
              >
                {confirmText}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Spinner({ size = 'md' }) {
  return <div className={`spinner ${size === 'lg' ? 'spinner-lg' : ''}`} />;
}

export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <img src={`${import.meta.env.BASE_URL}assets/brand/adesivo_nome_simbolo.png`} alt="Kairo Automações" />
      <Spinner size="lg" />
      <p className="text-muted">Carregando...</p>
    </div>
  );
}

export function EmptyState({ icon = '📋', title, text, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-text">{text}</p>
      {action}
    </div>
  );
}

export function Avatar({ src, name, size = 'md' }) {
  const sizeClass = size !== 'md' ? `avatar-${size}` : '';
  const initials = name
    ? name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <div className={`avatar ${sizeClass}`}>
      {src ? (
        <img src={src} alt={name} />
      ) : (
        initials
      )}
    </div>
  );
}

export function Badge({ children, variant = 'neutral' }) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
