/* ロゴの読み込み口。
   src/ 配下に置いて import することで、ファイル名にハッシュが付く。
   差し替えるとファイル名が変わるので、端末に古いロゴが残らない。
   （public/ に置くとハッシュが付かず、キャッシュで最大7日古いものが出る） */
import horizontalOrange from '../assets/logo-cruto-horizontal-orange.png'
import horizontalWhite from '../assets/logo-cruto-horizontal-white.png'
import markOnly from '../assets/logo-cruto-mark-only.png'

export { horizontalOrange, horizontalWhite, markOnly }
