import { Component } from 'react'

/* 画面の描画中にエラーが起きたとき、真っ白なページにせず原因を表示する受け皿。
   本番でしか通らない経路の不具合でも、現場で「何が起きたか」が分かるようにする。 */
export default class ScreenErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err, info) {
    console.error('screen render error:', err, info)
  }

  componentDidUpdate(prev) {
    // 画面を切り替えたらエラー表示を解除する(他の画面は使えるようにする)
    if (prev.screenKey !== this.props.screenKey && this.state.err) this.setState({ err: null })
  }

  render() {
    if (!this.state.err) return this.props.children
    const msg = (this.state.err && this.state.err.message) || String(this.state.err)
    return (
      <div className="screen">
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--danger-500)', borderRadius: 12, padding: '22px 24px', maxWidth: 720 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--danger-700)' }}>この画面の表示中にエラーが発生しました</div>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', marginTop: 8, lineHeight: 1.7 }}>
            他の画面は引き続き使えます。左のメニューから別の画面に切り替えるか、ページを再読み込みしてください。<br />
            解消しない場合は、下のメッセージをそのままお知らせください。
          </div>
          <pre style={{ marginTop: 12, fontSize: 12, color: 'var(--fg-2)', background: 'var(--bg-subtle)', borderRadius: 8, padding: '10px 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg}</pre>
          <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>ページを再読み込み</button>
        </div>
      </div>
    )
  }
}
