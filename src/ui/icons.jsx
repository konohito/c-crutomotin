// Lucide 系の 24×24 stroke アイコン。paths に d 文字列を列挙して描画する。
export const ICON_PATHS = {
  dash: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  imp: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M7 8h8', 'M7 12h10', 'M7 16h6'],
  cal: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  ros: ['M18 20a6 6 0 0 0-12 0', 'M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
  mob: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M12 18h.01'],
  ana: ['M3 3v16a2 2 0 0 0 2 2h16', 'M7 16v-5', 'M11 16V9', 'M15 16v-3', 'M19 16V8'],
  pdf: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v5h5', 'M12 12v6', 'm9 15 3 3 3-3'],
  sheet: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v5h5', 'M9 13h6', 'M9 17h4'],
  csv: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M19 8v6', 'M22 11h-6'],
  search: ['M21 21l-4.3-4.3', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16'],
  bell: ['M10.268 21a2 2 0 0 0 3.464 0', 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326'],
  plus: ['M5 12h14', 'M12 5v14'],
  check: ['M20 6 9 17l-5-5'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  chevR: ['m9 18 6-6-6-6'],
  chevL: ['m15 18-6-6 6-6'],
  back: ['M19 12H5', 'm12 19-7-7 7-7'],
  warn: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z', 'M12 9v4', 'M12 17h.01'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  printer: ['M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6', 'M6 15h12v7H6z'],
  camera: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z', 'M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 16v-4', 'M12 8h.01'],
  file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v5h5', 'M8 13h2', 'M14 13h2', 'M8 17h2', 'M14 17h2'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  csvout: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6', 'M3 9h18', 'M3 15h7', 'M3 5v14a2 2 0 0 0 2 2h5', 'M17 14v7', 'm14 18 3 3 3-3'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  staff: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
}
// ナビ ID とアイコン名が異なるものの別名(CSV 出力画面 = exp)
ICON_PATHS.exp = ICON_PATHS.csvout

export function Icon({ name, size = 18, strokeWidth = 1.5, style, className }) {
  const paths = ICON_PATHS[name] || []
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={style} className={className} aria-hidden="true"
    >
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}
