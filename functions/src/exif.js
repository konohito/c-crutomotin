'use strict'
/* JPEG の EXIF 回転情報(Orientation)の取り出しと、表示座標 → 生画素の対応付け。

   スマホで撮った写真は、センサーの生の向きのまま保存され「表示するときに何度回すか」を
   EXIF に持つことが多い(縦に構えて撮っても中身は横、など)。
   Document AI は回転を補正した向きで座標を返すのに対し、jpeg-js は EXIF を見ずに
   生の画素をそのまま返すため、両者の座標系がずれて読み取りが破綻する。
   ここで EXIF の向きを読み、表示座標から生画素へ引き直す。 */

// JPEG バイト列 → EXIF Orientation(1〜8)。見つからなければ 1(回転なし)。
function exifOrientation(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return 1
  let p = 2
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xFF) { p++; continue }         // マーカー境界のパディングを読み飛ばす
    const marker = buf[p + 1]
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue }
    if (marker === 0xDA || marker === 0xD9) break  // 画像データ本体に到達
    const len = buf.readUInt16BE(p + 2)
    if (len < 2 || p + 2 + len > buf.length) break
    if (marker === 0xE1 && buf.slice(p + 4, p + 10).toString('latin1') === 'Exif\0\0') {
      const o = readOrientation(buf, p + 10, p + 2 + len)
      if (o) return o
    }
    p += 2 + len
  }
  return 1
}

// TIFF ヘッダ(APP1 の Exif\0\0 直後)から IFD0 の Orientation タグ(0x0112)を読む
function readOrientation(buf, tiff, end) {
  if (tiff + 8 > end) return 0
  const bom = buf.toString('latin1', tiff, tiff + 2)
  const le = bom === 'II'
  if (!le && bom !== 'MM') return 0
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o))
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))
  if (u16(tiff + 2) !== 0x002A) return 0
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > end) return 0
  const n = u16(ifd)
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > end) break
    if (u16(e) === 0x0112) {
      const v = u16(e + 8)
      return v >= 1 && v <= 8 ? v : 0
    }
  }
  return 0
}

/* 表示向き(Document AI の座標系)→ 生画素の対応。
   戻り値の W/H は表示向きでの幅・高さ、at(x, y) は生画素の [x, y]。 */
function orientMap(orient, rw, rh) {
  const swap = orient >= 5 && orient <= 8
  const MAPS = {
    1: (x, y) => [x, y],
    2: (x, y) => [rw - 1 - x, y],                  // 左右反転
    3: (x, y) => [rw - 1 - x, rh - 1 - y],         // 180 度
    4: (x, y) => [x, rh - 1 - y],                  // 上下反転
    5: (x, y) => [y, x],                           // 転置
    6: (x, y) => [y, rh - 1 - x],                  // 右 90 度
    7: (x, y) => [rw - 1 - y, rh - 1 - x],         // 転置(逆)
    8: (x, y) => [rw - 1 - y, x],                  // 左 90 度
  }
  return { W: swap ? rh : rw, H: swap ? rw : rh, at: MAPS[orient] || MAPS[1] }
}

module.exports = { exifOrientation, orientMap }
