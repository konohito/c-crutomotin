import { useEffect } from 'react'
import D from './data/engine.js'
import { useStore, pendingSheets, allEvents, StoreProvider } from './store.jsx'
import { mdw } from './lib/helpers.js'
import { dbEnabled } from './lib/db.js'
import { Icon } from './ui/icons.jsx'
import { Toast } from './ui/kit.jsx'
import AuthGate, { useAuth } from './ui/AuthGate.jsx'
import Dashboard from './screens/Dashboard.jsx'
import ImportScreen from './screens/Import.jsx'
import CsvImport from './screens/CsvImport.jsx'
import CsvExport from './screens/CsvExport.jsx'
import Roster from './screens/Roster.jsx'
import Detail from './screens/Detail.jsx'
import Analytics from './screens/Analytics.jsx'
import Calendar from './screens/Calendar.jsx'
import PdfExport from './screens/PdfExport.jsx'
import SheetMaker from './screens/SheetMaker.jsx'
import Mobile from './screens/Mobile.jsx'
import Staff from './screens/Staff.jsx'
import ReviewModal from './modals/ReviewModal.jsx'
import RegisterModal from './modals/RegisterModal.jsx'
import EventModal from './modals/EventModal.jsx'
import { EditUserModal, EditMeasModal } from './modals/EditModals.jsx'
import { staffAdminEnabled } from './lib/staffAdmin.js'

const BASE = import.meta.env.BASE_URL

const TITLES = {
  dash: ['ダッシュボード', '令和7年度 介護予防・体力測定の状況'],
  imp: ['取り込み', '記録用紙のスキャン読み取りと本登録'],
  csv: ['利用者情報取り込み', '名簿・記録 CSV からの一括登録'],
  ros: ['利用者台帳', () => `登録 ${D.users.length} 名 · ${D.MUNIS.length} 市町村`],
  det: ['個人詳細', '時系列の測定結果と評価'],
  cal: ['カレンダー', '測定会・教室・会議の予定管理'],
  sheet: ['用紙作成', '読み取り対応の記録用紙を印刷'],
  ana: ['集計分析', '市町村・圏域別の年次集計'],
  pdf: ['PDF 出力', '個人結果票の一括出力'],
  exp: ['CSV 出力', '県報告用データの一括出力'],
  mob: ['モバイル撮影', '現場スタッフ用の撮影フロー'],
  staff: ['職員管理', 'ログインできる職員アカウントの追加・解除'],
}

const NAV_MAIN = [
  ['dash', 'ダッシュボード'],
  ['imp', '取り込み'],
  ['csv', '利用者情報取り込み'],
  ['cal', 'カレンダー'],
  ['sheet', '用紙作成'],
  ['ros', '利用者台帳'],
  ['mob', 'モバイル撮影'],
]
const NAV_ANA = [
  ['ana', '集計分析'],
  ['pdf', 'PDF 出力'],
  ['exp', 'CSV 出力'],
]

function NavItem({ id, label, badge }) {
  const { state, set } = useStore()
  const active = state.screen === id
  return (
    <button className={`nav-item${active ? ' active' : ''}`} onClick={() => set({ screen: id, navOpen: false })}>
      <Icon name={id} size={18} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge ? <span className="nav-badge t-num">{badge}</span> : null}
    </button>
  )
}

function Sidebar() {
  const { state, set } = useStore()
  const pending = pendingSheets(state)
  const nextMeas = allEvents(state).filter(e => e.kind === 'meas' && e.date >= D.TODAY).sort((a, b) => a.date.localeCompare(b.date))[0]
  return (
    <aside className={`sidebar noprint${state.navOpen ? ' open' : ''}`}>
      <div className="sidebar-brand">
        <img src={`${BASE}assets/logo-cruto-horizontal-orange.png`} alt="Cruto" style={{ height: 34, display: 'block' }} />
        <div className="t-display" style={{ fontSize: 14, letterSpacing: '0.05em', color: 'var(--slate-800)', background: 'var(--slate-100)', borderRadius: 5, padding: '1px 7px 2px 6px' }}>motion</div>
      </div>
      <nav className="sidebar-nav">
        <div className="t-overline" style={{ padding: '4px 12px 6px' }}>業務</div>
        {/* 本番(実データ)は OCR 連携が未完成のため 取り込み・モバイル撮影を隠す */}
        {NAV_MAIN.filter(([id]) => !(dbEnabled() && (id === 'imp' || id === 'mob'))).map(([id, label]) => (
          <NavItem key={id} id={id} label={label} badge={id === 'imp' && pending.length > 0 ? pending.length : 0} />
        ))}
        <div className="t-overline" style={{ padding: '14px 12px 6px' }}>分析</div>
        {NAV_ANA.map(([id, label]) => <NavItem key={id} id={id} label={label} badge={0} />)}
        {staffAdminEnabled() && (
          <>
            <div className="t-overline" style={{ padding: '14px 12px 6px' }}>管理</div>
            <NavItem id="staff" label="職員管理" badge={0} />
          </>
        )}
      </nav>
      <button className="sidebar-next" onClick={() => set({ screen: 'cal', navOpen: false })}>
        <div className="t-overline" style={{ color: 'var(--brand-700)' }}>次回の測定会</div>
        <div className="t-num" style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
          {nextMeas ? (nextMeas.date === D.TODAY ? '本日 · ' : '') + mdw(nextMeas.date) : '予定なし'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nextMeas ? `${nextMeas.muni} ${nextMeas.venue}` : '—'}
        </div>
        {pending.length > 0 && (
          <div className="t-num" style={{ fontSize: 11, color: 'var(--warning-700)', marginTop: 6 }}>要確認の用紙 {pending.length} 件</div>
        )}
      </button>
      <SidebarUser />
    </aside>
  )
}

// ログイン中の職員（Firebase 認証時）。未設定のデモではダミーの職員名を表示する。
function SidebarUser() {
  const { user, enabled, profile, signOut } = useAuth()
  const email = user && (user.email || '')
  const name = enabled ? ((profile && profile.name) || (user && user.displayName) || (email ? email.split('@')[0] : '職員')) : '相馬 直樹'
  const sub = enabled ? email : '事務局 · 管理者権限'
  const initial = (name || '職').trim().charAt(0)
  return (
    <div className="sidebar-user">
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, var(--slate-200), var(--slate-300))', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', flexShrink: 0 }}>{initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
      </div>
      {enabled && (
        <button className="icon-btn" title="ログアウト" aria-label="ログアウト" onClick={() => signOut()} style={{ flexShrink: 0 }}>
          <Icon name="logout" size={17} />
        </button>
      )}
    </div>
  )
}

function Header() {
  const { state, set } = useStore()
  const pending = pendingSheets(state)
  const [title, sub] = TITLES[state.screen] || TITLES.dash
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
        e.preventDefault()
        document.getElementById('global-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <header className="app-header noprint">
      <button className="icon-btn menu-btn" aria-label="メニュー" onClick={() => set({ navOpen: true })}>
        <Icon name="menu" size={18} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div className="header-sub" style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.4 }}>{typeof sub === 'function' ? sub() : sub}</div>
      </div>
      <div className="header-search">
        <input
          id="global-search"
          placeholder="氏名・かな・ID で検索…"
          value={state.q}
          onChange={(e) => set({ q: e.target.value, rosPage: 0, screen: 'ros' })}
        />
        <div className="search-icon"><Icon name="search" size={16} /></div>
      </div>
      {!dbEnabled() && (
        <button className="icon-btn" title="確認が必要な用紙" onClick={() => set({ screen: 'imp' })}>
          <Icon name="bell" size={18} />
          {pending.length > 0 && (
            <span className="t-num" style={{ position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, borderRadius: 999, background: 'var(--danger-500)', border: '1.5px solid #fff', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{pending.length}</span>
          )}
        </button>
      )}
      {state.screen === 'ros' && (
        <button className="btn btn-primary" onClick={() => set({ regOpen: true, regError: '' })}>
          <Icon name="plus" size={15} strokeWidth={2} />
          <span className="btn-label">新規登録</span>
        </button>
      )}
    </header>
  )
}

const SCREENS = {
  dash: Dashboard, imp: ImportScreen, csv: CsvImport, ros: Roster, det: Detail,
  ana: Analytics, cal: Calendar, pdf: PdfExport, sheet: SheetMaker, mob: Mobile, exp: CsvExport, staff: Staff,
}

function AppInner() {
  const { state, set } = useStore()
  const Screen = SCREENS[state.screen] || Dashboard
  return (
    <div className="app-root">
      <Sidebar />
      {state.navOpen && <div className="sidebar-backdrop noprint" onClick={() => set({ navOpen: false })} />}
      <main className="app-main">
        <Header />
        <div className="app-content">
          <Screen key={state.screen} />
        </div>
      </main>
      {state.mdNo !== null && <ReviewModal />}
      {state.regOpen && <RegisterModal />}
      {state.evOpen && <EventModal />}
      {state.editUser && <EditUserModal />}
      {state.editMeas && <EditMeasModal />}
      <Toast msg={state.toast} />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <AuthGate>
        <AppInner />
      </AuthGate>
    </StoreProvider>
  )
}
