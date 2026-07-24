import { useEffect } from 'react'
import { Icon } from './icons.jsx'

export function Card({ children, pad = false, clickable = false, style, onClick, className = '' }) {
  return (
    <div
      className={`card${pad ? ' pad' : ''}${clickable ? ' clickable' : ''} ${className}`}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function Pill({ bg, fg, children, lg = false, style }) {
  return (
    <span className={`pill${lg ? ' lg' : ''}`} style={{ background: bg, color: fg, ...style }}>
      {children}
    </span>
  )
}

export function Segmented({ options, value, onChange, sm = false }) {
  return (
    <div className={`segmented${sm ? ' sm' : ''}`}>
      {options.map(o => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  )
}

export function Select({ value, onChange, options, sm = false, style }) {
  return (
    <select className={`select${sm ? ' sm' : ''}`} value={value} onChange={onChange} style={style}>
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  )
}

export function RadioCard({ on, label, desc, onClick }) {
  return (
    <div className={`radio-card${on ? ' on' : ''}`} onClick={onClick} role="radio" aria-checked={on}>
      <div className="radio-dot" />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{desc}</div>}
      </div>
    </div>
  )
}

export function CheckRow({ on, label, onClick }) {
  return (
    <div className={`check-row${on ? ' on' : ''}`} onClick={onClick} role="checkbox" aria-checked={on}>
      <div className="check-box">
        {on && <Icon name="check" size={11} strokeWidth={3} style={{ color: '#fff' }} />}
      </div>
      <div style={{ fontSize: 13 }}>{label}</div>
    </div>
  )
}

export function Modal({ onClose, width, children, className = '' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop noprint" onClick={onClose}>
      <div className={`modal-panel ${className}`} style={{ width }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function ModalHead({ icon, iconBg, iconFg, title, sub, onClose }) {
  return (
    <div className="modal-head">
      {icon && (
        <div style={{ width: 32, height: 32, borderRadius: 8, background: iconBg, color: iconFg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name={icon} size={17} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{sub}</div>}
      </div>
      <button className="modal-x" onClick={onClose} aria-label="閉じる">
        <Icon name="x" size={17} />
      </button>
    </div>
  )
}

// 確認ダイアログ（window.confirm の代替）。破壊的な操作は danger を立てて赤の実行ボタンにする。
export function ConfirmModal({ icon = 'warn', title, body, confirmLabel = '実行する', danger = false, busy = false, onConfirm, onClose }) {
  return (
    <Modal onClose={onClose} width={440}>
      <ModalHead icon={icon}
        iconBg={danger ? 'var(--danger-50)' : 'var(--warning-50)'}
        iconFg={danger ? 'var(--danger-700)' : 'var(--warning-700)'}
        title={title} onClose={onClose} />
      <div style={{ padding: '2px 22px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.75 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>キャンセル</button>
          <button className={`btn${danger ? '' : ' btn-primary'}`} disabled={busy} onClick={onConfirm}
            style={danger ? { background: 'var(--danger-500)', color: '#fff', boxShadow: 'var(--shadow-xs), inset 0 1px 0 rgba(255,255,255,0.18)' } : undefined}>
            {busy ? '処理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function Toast({ msg }) {
  if (!msg) return null
  return (
    <div className="toast noprint" role="status">
      <Icon name="check" size={16} strokeWidth={2.5} style={{ color: 'var(--success-500)', flexShrink: 0 }} />
      {msg}
    </div>
  )
}

export function Overline({ children, style }) {
  return <div className="t-overline" style={style}>{children}</div>
}
