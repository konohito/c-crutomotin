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
      <div className={`modal-panel ${className}`} style={{ width }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
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

// 種別ごとにアイコンと色を変える（エラーまで緑チェックにならないように）
const TOAST_KIND = {
  ok: ['check', 'var(--success-500)'],
  err: ['warn', '#FF9D9D'],
  info: ['info', '#8FBCF7'],
}
export function Toast({ msg }) {
  if (!msg) return null
  const { text, type } = typeof msg === 'string' ? { text: msg, type: 'ok' } : msg
  const [icon, color] = TOAST_KIND[type] || TOAST_KIND.ok
  return (
    <div className="toast noprint" role={type === 'err' ? 'alert' : 'status'}>
      <Icon name={icon} size={16} strokeWidth={2.5} style={{ color, flexShrink: 0 }} />
      {text}
    </div>
  )
}

export function Overline({ children, style }) {
  return <div className="t-overline" style={style}>{children}</div>
}
