import { Fragment } from 'react'
import D from '../data/engine.js'
import { kclScore } from '../data/kihon.js'
import { useStore, allMunis } from '../store.jsx'
import { wardLabel } from '../lib/db.js'
import { RadioCard, Select, Overline } from '../ui/kit.jsx'
import { Icon } from '../ui/icons.jsx'

/* 介護予防手帳 — 3 分冊の印刷画面。
   ① 記録手帳(持参用): セルフケアマネジメントを支援。毎日の体調・活動記録
   ② 資料集(保管用): 理解を支援。予防の知識・地域の相談先・書類保管
   ③ サポーターマニュアル: サポーター活動の実践的な手引き
   記録手帳は台帳と統合: 1 名ごとに氏名・基本情報・直近の測定結果を差し込んで印刷できる。
   スキャン読み取り対象外のため四隅マーカーは付けない。両面印刷で冊子にする想定。 */

const distinct = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
// 1 冊 8 ページ × 人数分をプレビューに並べるため、一度に印刷する人数は絞る
const PRINT_CAP = 12

const P = ({ children, pad = '46px 52px 40px' }) => (
  <div className="pdf-page" style={{ padding: pad, color: '#111' }}>{children}</div>
)
const H1 = ({ children }) => <div style={{ fontSize: 24, fontWeight: 700, borderBottom: '2.5px solid var(--brand-500)', paddingBottom: 6, marginBottom: 14 }}>{children}</div>
const H2 = ({ children, mt = 16 }) => <div style={{ fontSize: 17, fontWeight: 700, background: 'var(--slate-100)', padding: '5px 10px', borderRadius: 6, margin: `${mt}px 0 8px` }}>{children}</div>
const Li = ({ children, fs = 14 }) => <div style={{ fontSize: fs, lineHeight: 1.75, paddingLeft: 14, textIndent: -14 }}>・{children}</div>
// 手書き用の記入行(ラベル + 下線)。value を渡すと台帳のデータを印字する
const WLine = ({ label, w = 120, h = 34, fs = 14, value }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `${w}px 1fr`, alignItems: 'end', gap: 8, height: h }}>
    <span style={{ fontSize: fs, color: '#333', paddingBottom: 4 }}>{label}</span>
    <span style={{ borderBottom: '1px solid #555', fontSize: 15, fontWeight: 600, paddingBottom: 3 }}>{value || ''}</span>
  </div>
)
const Foot = ({ no, title }) => (
  <>
    <div style={{ flex: 1 }} />
    <div style={{ borderTop: '1px solid var(--slate-300)', paddingTop: 5, display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--slate-500)' }}>
      <span>介護予防手帳 · {title}</span><span className="t-num">{no}</span>
    </div>
  </>
)
const Cover = ({ badge, title, subtitle, items, name, user }) => (
  <P>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700, border: '1.5px solid #111', borderRadius: 999, padding: '5px 22px' }}>{badge}</div>
      <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '0.06em' }}>介護予防手帳</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand-600)' }}>{title}</div>
      <div style={{ fontSize: 15, lineHeight: 2, color: '#333' }}>{subtitle}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        {items.map((t, i) => <Li key={i} fs={14.5}>{t}</Li>)}
      </div>
      {user ? (
        <div style={{ marginTop: 18, border: '1.5px solid #111', borderRadius: 10, padding: '12px 26px', textAlign: 'center' }}>
          <div style={{ fontSize: 11.5, color: '#555' }}>{user.kana}</div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '0.04em' }}>{user.name}</div>
          <div style={{ fontSize: 12.5, color: '#333', marginTop: 4 }}>参加者ID <span className="t-num" style={{ fontWeight: 700 }}>{user.id}</span> · {user.muniName}{user.venueName ? ' · ' + user.venueName : ''}</div>
        </div>
      ) : name && (
        <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '80px 260px', alignItems: 'end', gap: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 600, paddingBottom: 6 }}>氏名</span>
          <span style={{ borderBottom: '1.5px solid #111', height: 42 }} />
        </div>
      )}
    </div>
  </P>
)

/* ==== ① 記録手帳(持参用) ==================================================== */
// 私のからだの記録: 台帳の測定結果・基本チェックリストを差し込む(共通版は書き込み用の空欄)
function BodyRecordPage({ user }) {
  const ys = user ? Object.keys(user.meas || {}).map(Number).sort((a, b) => a - b).slice(-3) : []
  while (ys.length < 3) ys.unshift(null)
  const items = D.SHEET_COLS.map(cid => D.COLS.find(c => c.id === cid))
  const cell = (last) => ({ borderBottom: last ? 'none' : '1px solid #555', borderRight: '1px solid #ccc', padding: '5px 8px', fontSize: 13.5, textAlign: 'center', minHeight: 30 })
  const val = (y, get) => (user && y && user.meas[y] ? get(user.meas[y]) : '')
  const rows = items.map(col => [col.label + '（' + col.unit + '）', (y) => val(y, m => D.fmt(m.values[col.id], col.dec))])
    .concat([
      ['BMI', (y) => val(y, m => D.fmt(m.values.bmi, 1))],
      ['総合スコア（100点満点）', (y) => val(y, m => m.total + ' 点')],
      ['基本チェックリスト（25点満点）', (y) => { const sc = user && y ? kclScore(user, y) : null; return sc ? sc.total + ' 点' : '' }],
    ])
  return (
    <P>
      <H1>私のからだの記録</H1>
      <div style={{ fontSize: 13.5, color: '#333', marginBottom: 10 }}>
        {user
          ? '台帳に登録されている直近 3 回分の結果です。次の測定会の結果は、もらった結果用紙から書き足しましょう。'
          : '測定会でもらった結果用紙から書き写しましょう（直近 3 回分）。変化に気づくことが予防の第一歩です。'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '212px 1fr 1fr 1fr', border: '1.5px solid #111' }}>
        <div style={{ borderBottom: '1px solid #111', borderRight: '1px solid #111', padding: '6px 8px', fontSize: 13, fontWeight: 700, background: 'var(--slate-100)' }}>測定項目</div>
        {ys.map((y, i) => (
          <div key={i} style={{ borderBottom: '1px solid #111', borderRight: i === 2 ? 'none' : '1px solid #555', padding: 6, fontSize: 13.5, fontWeight: 700, textAlign: 'center', background: 'var(--slate-100)' }}>
            {y ? <span className="t-num">{D.ERA[y]}年度</span> : '　　　年度'}
          </div>
        ))}
        {rows.map(([label, get], ri) => (
          <Fragment key={label}>
            <div style={{ ...cell(ri === rows.length - 1), borderRight: '1px solid #111', textAlign: 'left', fontSize: 12.5, fontWeight: 600 }}>{label}</div>
            {ys.map((y, i) => (
              <div key={i} className="t-num" style={{ ...cell(ri === rows.length - 1), borderRight: i === 2 ? 'none' : '1px solid #ccc' }}>{get(y)}</div>
            ))}
          </Fragment>
        ))}
      </div>
      <H2 mt={14}>結果を見て感じたこと・次にがんばりたいこと</H2>
      {[0, 1].map(i => <div key={i} style={{ borderBottom: '1px solid #555', height: 36 }} />)}
      <Foot no={4} title="記録手帳" />
    </P>
  )
}

function RecordPages(user) {
  const days = ['月', '火', '水', '木', '金', '土', '日']
  const rows = ['血圧（上/下）', '体重（kg）', '睡眠（時間）', '食事（回）', '水分（杯）', '気分（◎○△）', '歩数・体操', '参加した場所']
  const week = (w) => (
    <P key={w} pad="42px 44px 36px">
      <H1>今日の体調チェック・活動記録（{w} 週目）</H1>
      <div style={{ fontSize: 13.5, color: '#333', marginBottom: 10 }}>毎日ひとつでも構いません。書けたら◎。通いの場でサポーターと一緒に見返しましょう。</div>
      <div style={{ display: 'grid', gridTemplateColumns: '128px repeat(7, 1fr)', border: '1.5px solid #111' }}>
        <div style={{ borderBottom: '1px solid #111', borderRight: '1px solid #111', padding: 6, fontSize: 13, fontWeight: 700, background: 'var(--slate-100)' }}>日付（　/　）</div>
        {days.map(d => <div key={d} style={{ borderBottom: '1px solid #111', borderRight: d === '日' ? 'none' : '1px solid #555', padding: 6, fontSize: 14, fontWeight: 700, textAlign: 'center', background: 'var(--slate-100)' }}>{d}</div>)}
        {rows.map((r, ri) => (
          [<div key={r} style={{ borderBottom: ri === rows.length - 1 ? 'none' : '1px solid #555', borderRight: '1px solid #111', padding: '14px 6px', fontSize: 12.5, fontWeight: 600 }}>{r}</div>,
            ...days.map(d => <div key={r + d} style={{ borderBottom: ri === rows.length - 1 ? 'none' : '1px solid #555', borderRight: d === '日' ? 'none' : '1px solid #ccc', minHeight: 52 }} />)]
        ))}
      </div>
      <H2 mt={14}>今週の気づき・メモ</H2>
      {[0, 1].map(i => <div key={i} style={{ borderBottom: '1px solid #555', height: 34 }} />)}
      <Foot no={4 + w} title="記録手帳" />
    </P>
  )
  return [
    <Cover key="c" badge="持参用" title="記録手帳" name user={user}
      subtitle={'毎日の体調と活動を記録する、あなたのセルフケアの手帳です。\n通いの場に持って行き、サポーターと一緒に確認しましょう。'}
      items={['毎日使う・通いの場に持って行く', '血圧・体重・歩数・気分などを記録し、体調の変化に気づく', 'フレイル予防のポイント（簡易版）付き']} />,
    <P key="p2">
      <H1>はじめに · この手帳の使い方</H1>
      <Li fs={15}>この手帳は、日々の体調の変化に気づき、介護予防（フレイル予防）に取り組むための記録手帳です。</Li>
      <Li fs={15}>1 日 1 回、体調チェックのページに記入しましょう。全部書けなくても大丈夫です。</Li>
      <Li fs={15}>通いの場や測定会に持って行き、サポーターや専門職と一緒に見返しましょう。</Li>
      <Li fs={15}>体調がすぐれない日が続くときは、かかりつけ医や相談窓口（資料集に一覧）に相談を。</Li>
      <H2>私の基本情報・緊急連絡先</H2>
      <WLine label="ふりがな / 氏名" w={130} value={user ? user.kana + '　' + user.name : ''} />
      <WLine label="参加者ID / 生年月日" w={150} value={user ? user.id + '　　' + user.birthDate + '（' + user.age + ' 歳）' : ''} />
      <WLine label="住所" w={130} value={user ? user.muniName + '　' + (user.venueName || '') : ''} />
      <WLine label="電話番号" w={130} value={user ? user.phone : ''} />
      <WLine label="かかりつけ医" w={130} />
      <WLine label="持病・服薬" w={130} />
      <WLine label="緊急連絡先 ①（氏名・続柄・電話）" w={230} />
      <WLine label="緊急連絡先 ②（氏名・続柄・電話）" w={230} />
      <Foot no={2} title="記録手帳" />
    </P>,
    <P key="p3">
      <H1>私の目標（なりたい姿）</H1>
      <div style={{ fontSize: 14.5, lineHeight: 1.8, marginBottom: 8 }}>「孫と旅行に行きたい」「畑仕事を続けたい」など、あなたのなりたい姿を書きましょう。目標があると、予防の取り組みが続きます。</div>
      {[0, 1, 2].map(i => <div key={i} style={{ borderBottom: '1px solid #555', height: 40 }} />)}
      <H2>興味・関心リスト（やってみたいことに ○）</H2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        {['散歩・ウォーキング', '体操・ストレッチ', '園芸・畑仕事', '料理', '手芸・工作', '囲碁・将棋', 'カラオケ・音楽', '読書', '旅行', 'ボランティア', '地域のサロン', 'グラウンドゴルフ', 'おしゃべり会', '習い事', 'その他（　　　　）'].map(t => (
          <span key={t} style={{ fontSize: 14, border: '1px solid #555', borderRadius: 999, padding: '5px 14px' }}>{t}</span>
        ))}
      </div>
      <H2>フレイル予防の 3 本柱（簡易版）</H2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {[['運動', '今より 10 分多く体を動かす（アクティブガイド「+10」）。片足立ち・かかと上げ・ゆっくりスクワット。'],
          ['栄養', '1 日 3 食。たんぱく質（肉・魚・卵・大豆）をしっかり。よく噛んで、口の健康も大切に。'],
          ['社会参加', '週 1 回は外出を。通いの場・サロン・趣味の集まりで人と話すことが一番の予防です。']].map(([t, b]) => (
            <div key={t} style={{ border: '1.5px solid var(--brand-500)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand-600)', marginBottom: 4 }}>{t}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>{b}</div>
            </div>
          ))}
      </div>
      <Foot no={3} title="記録手帳" />
    </P>,
    <BodyRecordPage key="body" user={user} />,
    ...[1, 2, 3, 4].map(week),
  ]
}

/* ==== ② 資料集(保管用) ====================================================== */
function ArchivePages() {
  const toc = [
    ['1. 知っておきたい基本の知識', ['① 介護予防とは？ フレイルとは？', '② 認知症の正しい知識']],
    ['2. 私の記録', ['③ 基本チェックリスト', '④ フレイルチェック', '⑤ 体力測定の結果']],
    ['3. 実践！予防のポイント', ['⑥ 運動・転倒予防', '⑦ 骨折予防', '⑧ 栄養（栄養士より）', '⑨ 口腔の健康（歯科衛生士より）', '⑩ 社会参加とこころの健康（認知症予防）', '⑪ お薬との付き合い方（薬剤師より）']],
    ['4. 地域の情報と相談窓口', ['⑫ 地域資源・相談先一覧', '⑬ 介護予防事業の案内', '⑭ サポーター・100 歳体操の紹介']],
    ['5. 私の大切な書類', ['⑮ 書類保管スペース（契約書・プラン・健診結果など）']],
  ]
  return [
    <Cover key="c" badge="保管用" title="資料集"
      subtitle={'介護予防・フレイル予防の知識を深め、\n支援者との共通理解のために。プランなどの書類もここに保管します。'}
      items={['フレイル予防の詳しい知識と実践のポイント', '地域資源・相談先・介護予防事業の案内', '契約書・プラン・健診結果など大切な書類のファイル']} />,
    <P key="toc">
      <H1>目次</H1>
      {toc.map(([sec, items]) => (
        <div key={sec} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, margin: '8px 0 4px' }}>{sec}</div>
          {items.map(t => <Li key={t} fs={14}>{t}</Li>)}
        </div>
      ))}
      <Foot no={2} title="資料集" />
    </P>,
    <P key="k1">
      <H1>知っておきたい基本の知識</H1>
      <H2 mt={4}>介護予防とは？ フレイルとは？</H2>
      <Li>フレイルとは、加齢により心身の働きが弱くなった「健康と要介護の中間」の状態です。</Li>
      <Li>フレイルは早く気づいて取り組めば、元の元気な状態に戻れます。</Li>
      <Li>「体重が減った」「疲れやすい」「歩くのが遅くなった」「握力が弱くなった」「活動が減った」は要注意のサインです。</Li>
      <Li>基本チェックリストや体力測定で、自分の状態を定期的に確認しましょう。</Li>
      <H2>認知症の正しい知識</H2>
      <Li>認知症は誰でもなり得る身近な病気です。早期発見・早期対応が大切です。</Li>
      <Li>「同じことを何度も聞く」「日付がわからない」「置き忘れが増えた」が続くときは、早めに相談を。</Li>
      <Li>運動・人との交流・バランスの良い食事は、認知症予防にも効果的といわれています。</Li>
      <Li>心配なときは、かかりつけ医や地域包括支援センターに相談しましょう。</Li>
      <H2>私の記録（ここに綴じましょう）</H2>
      <Li>基本チェックリスト・フレイルチェック・体力測定の結果用紙は、この資料集に綴じて保管します。</Li>
      <Li>年度ごとに見比べると、自分の変化がよくわかります。</Li>
      <Foot no={3} title="資料集" />
    </P>,
    <P key="k2">
      <H1>実践！予防のポイント</H1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[['運動・転倒予防', '週 2 回以上の運動習慣を。片足立ち・かかと上げ・ゆっくりスクワット。家の中の段差や滑りやすい場所を片づけ、転倒を防ぎましょう。'],
          ['骨折予防', 'カルシウム・ビタミン D をとり、日光を浴びて骨を丈夫に。転倒予防と合わせて骨折を防ぎます。'],
          ['栄養（栄養士より）', '1 日 3 食、主食・主菜・副菜をそろえて。特にたんぱく質と水分を意識。6 か月で 2〜3kg 減ったら要注意です。'],
          ['口腔の健康（歯科衛生士より）', 'よく噛んで食べる・口の体操・毎日の歯みがき。むせやすくなったら歯科や専門職に相談を。'],
          ['社会参加とこころの健康', '週 1 回の外出・人との会話が、こころと認知機能の健康を守ります。通いの場・サロンに参加しましょう。'],
          ['お薬との付き合い方（薬剤師より）', 'お薬手帳を 1 冊にまとめ、飲み合わせは薬剤師に相談を。自己判断で中止せず、残薬も相談しましょう。']].map(([t, b]) => (
            <div key={t} style={{ border: '1px solid var(--slate-300)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--brand-600)', marginBottom: 4 }}>{t}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>{b}</div>
            </div>
          ))}
      </div>
      <Foot no={4} title="資料集" />
    </P>,
    <P key="k3">
      <H1>地域の情報と相談窓口</H1>
      <div style={{ fontSize: 13.5, marginBottom: 8 }}>お住まいの地域の窓口を書き込んでおきましょう。困ったときはひとりで悩まず相談を。</div>
      {[['地域包括支援センター'], ['市町村の介護保険担当課'], ['かかりつけ医・かかりつけ歯科'], ['民生委員・サポーター'], ['通いの場・サロン（曜日・場所）'], ['その他の相談先']].map(([label]) => (
        <div key={label} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', borderBottom: '1px solid #555', alignItems: 'end', height: 44 }}>
          <span style={{ fontSize: 14, fontWeight: 600, paddingBottom: 5 }}>{label}</span>
          <span style={{ fontSize: 12, color: '#888', paddingBottom: 5 }}>名称・電話番号など</span>
        </div>
      ))}
      <H2>介護予防事業・サポーター活動</H2>
      <Li>地域の介護予防教室・100 歳体操などの案内は、このページに挟んで保管しましょう。</Li>
      <Li>サポーターは、通いの場などで介護予防活動を支える地域の担い手です。興味のある方は窓口へ。</Li>
      <H2>私の大切な書類（保管スペース）</H2>
      <Li>契約書・ケアプラン・健診結果・お薬の説明書などは、この資料集の後ろにまとめて綴じましょう。</Li>
      <Foot no={5} title="資料集" />
    </P>,
  ]
}

/* ==== ③ サポーターマニュアル ================================================= */
function SupporterPages() {
  return [
    <Cover key="c" badge="サポーター用" title="支援マニュアル"
      subtitle={'サポーターが多様な活動において、自信を持って安全に、\nかつ具体的に活動するための実践的な手引きです。'}
      items={['サポーターの役割と活動の基本ルール', '活動別の実践マニュアル（通いの場・生活支援・認知症関係）', '気づきと「つなぎ」の技術・活動記録']} />,
    <P key="s1">
      <H1>サポーターとは · 活動の基本ルール</H1>
      <H2 mt={4}>サポーターとは</H2>
      <Li>通いの場や生活支援の場で、介護予防・フレイル予防の活動を支える地域の担い手です。</Li>
      <Li>専門職の指示・監修のもと、無理のない範囲で活動します。判断に迷ったら必ず専門職へ。</Li>
      <H2>活動の基本ルール（守秘義務）</H2>
      <Li>活動で知り得た個人の情報は、家族や友人にも決して話しません（守秘義務）。</Li>
      <Li>個人情報が書かれた書類・記録は持ち歩かず、決められた場所で保管します。</Li>
      <Li>利用者との適切な距離感を保ち、金銭の貸し借り・個人的な契約はしません。</Li>
      <H2>コミュニケーションの基本技術</H2>
      <Li>傾聴: 相手の話を途中でさえぎらず、うなずき・あいづちで「聴いている」ことを伝えます。</Li>
      <Li>声かけのコツ: 正面から、目線を合わせ、ゆっくり・はっきり・短く。否定せず、まず受け止める。</Li>
      <Li>できないことではなく「できていること」に目を向けて言葉にしましょう。</Li>
      <Foot no={2} title="サポーターマニュアル" />
    </P>,
    <P key="s2">
      <H1>実践マニュアル（活動別）</H1>
      <H2 mt={4}>通いの場・介護予防教室でのポイント</H2>
      <Li>健康チェック: はじめに顔色・歩き方・声の張りを観察。「今日の体調はいかがですか」から始めます。</Li>
      <Li>フレイル予防のミニ講話: 記録手帳の「3 本柱」（運動・栄養・社会参加）を使って 3 分で紹介できます。</Li>
      <Li>フレイルチェック・体力測定: 手順書に沿って実施し、無理をさせない。ふらつきがある方は必ず隣で支えます。</Li>
      <Li>集団活動の安全管理: 転倒しやすい環境（コード・段差・濡れた床）を事前に確認。水分補給の声かけを。</Li>
      <H2>生活支援でのポイント</H2>
      <Li>訪問時は身分がわかるものを提示し、約束の時間を守ります。</Li>
      <Li>生活環境の観察: 玄関・廊下の段差、食事の様子、郵便物のたまり具合などの変化に気づいたら記録・報告。</Li>
      <H2>認知症の方への基本的対応</H2>
      <Li>驚かせない・急がせない・自尊心を傷つけない、が 3 原則です。</Li>
      <Li>同じ話が繰り返されても、初めて聞くように受け止めます。間違いを正面から訂正しません。</Li>
      <Foot no={3} title="サポーターマニュアル" />
    </P>,
    <P key="s3">
      <H1>気づきと「つなぎ」の技術 · 活動記録</H1>
      <H2 mt={4}>観察ポイント（いつもと違う？）</H2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        {['体重が減った様子', '歩き方がゆっくりに', 'むせが増えた', '着衣・身なりの乱れ', '同じ話の繰り返しが急に増えた', '欠席が続く', '表情が暗い', '家の様子の変化'].map(t => (
          <span key={t} style={{ fontSize: 13, border: '1px solid #555', borderRadius: 999, padding: '4px 12px' }}>{t}</span>
        ))}
      </div>
      <H2>つなぎのフローチャート</H2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '4px 0 6px' }}>
        {['気づく（観察ポイント）', '記録する（活動記録）', '報告する（担当職員・専門職）', '必要に応じて相談窓口へ'].map((t, i, a) => (
          <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, border: '1.5px solid var(--brand-500)', borderRadius: 8, padding: '8px 12px' }}>{t}</span>
            {i < a.length - 1 && <span style={{ fontSize: 16, fontWeight: 700 }}>→</span>}
          </span>
        ))}
      </div>
      <Li>緊急時（転倒・意識がない・強い痛み）は、その場で 119 番と担当職員への連絡を最優先します。</Li>
      <H2>困った時の相談先（書き込み）</H2>
      <WLine label="担当職員（名前・電話）" w={190} />
      <WLine label="地域包括支援センター" w={190} />
      <H2>活動記録</H2>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', border: '1.5px solid #111' }}>
        {['日付', '活動内容', '気づき・共有事項'].map((h, i) => (
          <div key={h} style={{ borderBottom: '1px solid #111', borderRight: i === 2 ? 'none' : '1px solid #555', padding: 5, fontSize: 12.5, fontWeight: 700, background: 'var(--slate-100)' }}>{h}</div>
        ))}
        {Array.from({ length: 5 }, (_, r) => [0, 1, 2].map(c => (
          <div key={r + '-' + c} style={{ borderBottom: r === 4 ? 'none' : '1px solid #555', borderRight: c === 2 ? 'none' : '1px solid #555', minHeight: 40 }} />
        )))}
      </div>
      <Foot no={4} title="サポーターマニュアル" />
    </P>,
  ]
}

const KINDS = [
  ['record', '記録手帳（持参用）', '毎日の体調・活動を記録するセルフケア手帳'],
  ['archive', '資料集（保管用）', '予防の知識・相談先・書類保管のファイル'],
  ['supporter', 'サポーターマニュアル', 'サポーター活動の実践的な手引き'],
]

export default function Techo() {
  const { state, set } = useStore()
  const kind = state.thKind || 'record'
  // 個人詳細の「手帳」ボタンから開いた場合: その方 1 名分を画面で閲覧(そのまま印刷も可)
  const viewUser = state.thUser ? D.users.find(x => x.id === state.thUser) : null
  // 記録手帳の氏名・情報: 共通(空欄で印刷) / 台帳から印字(1 名 1 冊・測定結果も差し込み)
  const thName = state.thName || 'blank'
  const perUser = !viewUser && kind === 'record' && thName === 'print'
  const mu = allMunis(state).find(x => x.id === state.thMuni) || D.MUNIS[0]
  const muniUsers = D.users.filter(u => u.muni === mu.id)
  const wardOpts = distinct(muniUsers.map(u => u.venueName))
  const ward = state.thWard || 'all'
  const allTargets = muniUsers.filter(u => ward === 'all' || u.venueName === ward)
    .slice().sort((a, b) => a.kana.localeCompare(b.kana, 'ja'))
  const targets = allTargets.slice(0, PRINT_CAP)

  const pages = kind === 'record'
    ? (viewUser
      ? RecordPages(viewUser)
      : perUser
      ? targets.map(u => <Fragment key={u.id}>{RecordPages(u)}</Fragment>)
      : RecordPages(null))
    : kind === 'archive' ? ArchivePages() : SupporterPages()
  const pageCount = perUser ? targets.length * 8 : pages.length

  return (
    <div className="print-screen panel-screen" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100%', minHeight: 0 }}>
      <div className="noprint side-panel" style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border-default)', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {viewUser && (
          <div>
            <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 6, marginBottom: 10 }} onClick={() => set({ screen: 'det', detId: viewUser.id })}>
              <Icon name="back" size={16} />
              個人詳細へ戻る
            </button>
            <div style={{ border: '1px solid var(--brand-200)', background: 'var(--brand-50)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--brand-700)' }}>{viewUser.kana}</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{viewUser.name} さんの手帳</div>
              <div className="t-num" style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 2 }}>ID {viewUser.id} · {viewUser.muniName}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-2)', lineHeight: 1.6, marginTop: 6 }}>
                記録手帳には台帳の基本情報と直近の測定結果が差し込まれています。そのまま印刷できます。
              </div>
            </div>
          </div>
        )}
        <div>
          <Overline style={{ marginBottom: 8 }}>冊子の種類</Overline>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {KINDS.map(([id, label, desc]) => (
              <RadioCard key={id} on={kind === id} label={label} desc={desc} onClick={() => set({ thKind: id })} />
            ))}
          </div>
        </div>
        {!viewUser && kind === 'record' && (
          <div>
            <Overline style={{ marginBottom: 8 }}>氏名・情報の表示</Overline>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <RadioCard on={thName === 'blank'} label="共通（空欄で印刷）" desc="氏名・記録は手書き。必要部数はプリンタで指定" onClick={() => set({ thName: 'blank' })} />
              <RadioCard on={thName === 'print'} label="台帳から印字（1名1冊）" desc="氏名・基本情報・直近の測定結果を差し込み" onClick={() => set({ thName: 'print' })} />
            </div>
          </div>
        )}
        {perUser && (
          <div>
            <Overline style={{ marginBottom: 8 }}>市町村</Overline>
            <Select value={mu.id} onChange={(e) => set({ thMuni: e.target.value, thWard: 'all' })} options={D.MUNIS.map(m => ({ v: m.id, l: m.name }))} style={{ width: '100%' }} />
          </div>
        )}
        {perUser && wardOpts.length > 0 && (
          <div>
            <Overline style={{ marginBottom: 8 }}>{wardLabel()}</Overline>
            <Select value={ward} onChange={(e) => set({ thWard: e.target.value })}
              options={[{ v: 'all', l: 'すべての' + wardLabel() }].concat(wardOpts.map(w => ({ v: w, l: w })))} style={{ width: '100%' }} />
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8 }}>
              対象 <span className="t-num" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{allTargets.length}</span> 名（五十音順）
              {allTargets.length > PRINT_CAP && <><br />一度に印刷できるのは <b>{PRINT_CAP} 名分</b>まで。{wardLabel()}で絞って印刷してください。</>}
            </div>
          </div>
        )}
        <div>
          <Overline style={{ marginBottom: 8 }}>この手帳について</Overline>
          <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.7 }}>
            介護予防手帳は 3 分冊構成です。<br />
            <b>記録手帳</b>は毎日使う持参用、<b>資料集</b>は知識と書類の保管用、
            <b>サポーターマニュアル</b>はサポーターだけが持つ手引きです。<br />
            バインダーで 1 冊にまとめても、必要な分冊だけ持ち運んでも使えます。
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
            {perUser
              ? <><span className="t-num" style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-1)' }}>{targets.length}</span> 名 × 8 ページ · A4 縦 · 両面印刷推奨</>
              : <><span className="t-num" style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-1)' }}>{pageCount}</span> ページ · A4 縦 · 両面印刷推奨</>}
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => window.print()}>
            <Icon name="printer" size={17} strokeWidth={1.8} />
            印刷する
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.6 }}>
            {perUser
              ? '台帳の氏名・基本情報と、直近 3 回分の測定結果・基本チェックリスト点数が「私のからだの記録」ページに印字されます。'
              : '記録手帳の記録ページ（1 週間 × 4）は、必要に応じてこのページだけ増し刷りして継ぎ足せます。'}
          </div>
        </div>
      </div>
      <div className="pdf-stage">
        <div className="pdf-pages">{pages}</div>
      </div>
    </div>
  )
}
