import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { StoreProvider, useStore } from './store.jsx'
import './styles/app.css'
import D from './data/engine.js'
import ImportScreen from './screens/Import.jsx'
import WalkIn from './screens/WalkIn.jsx'
import TechoList from './screens/TechoList.jsx'
import CsvImport from './screens/CsvImport.jsx'
import { EditKclModal, EditMeasModal } from './modals/EditModals.jsx'

// 本番のみで開く「基本チェックリスト回答を編集」モーダルの描画スモーク
function KclEditSmoke() {
  const { state, set } = useStore()
  useEffect(() => { set({ editKcl: { id: D.users[0].id, year: D.CUR } }) }, [])
  return state.editKcl ? <EditKclModal /> : <div>準備中…</div>
}

// 「測定値を編集」モーダル(評価年・評価日を含む)の描画スモーク
function MeasEditSmoke() {
  const { state, set } = useStore()
  useEffect(() => { set({ editMeas: { id: D.users[0].id, year: D.CUR } }) }, [])
  return state.editMeas ? <EditMeasModal /> : <div>準備中…</div>
}

/* 本番モード(VITE_FIREBASE_CONFIG あり)でしか描画されない画面の、描画スモーク用エントリ。
   通常のデモビルドでは ProdImport などが一度も描画されず、本番だけで落ちる不具合
   (未読み込み状態の null 参照など)を検出できないため、ログインを挟まずに直接描画する。

   使い方:
     VITE_FIREBASE_CONFIG='{"apiKey":"smoke",...}' npm run build:smoke
     dist-smoke/smoke.html?s=imp|walkin|techolist を開く(通信は失敗するが描画は検証できる)
   ※ 本番ビルド(index.html)からは参照されないため、配信物には含まれない。 */
const SCREENS = { imp: ImportScreen, walkin: WalkIn, techolist: TechoList, csv: CsvImport, kcledit: KclEditSmoke, measedit: MeasEditSmoke }
const which = new URLSearchParams(location.search).get('s') || 'imp'
const Screen = SCREENS[which] || ImportScreen
createRoot(document.getElementById('root')).render(<StoreProvider><Screen /></StoreProvider>)
