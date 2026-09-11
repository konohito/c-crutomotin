/* 未定義の識別子（実行時に ReferenceError になるもの）を src 全体から洗い出す。

   ビルドは通るのに画面を開くと落ちる、という事故を防ぐための検査。
   実際に「測定を測定日ごとに変える」改修で、Detail.jsx の ys だけ定義が消えて
   参照が残り、個人詳細が開けなくなった（ビルドは通っていた）。
   使い方: npm run check:undefined */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
const traverse = _traverse.default || _traverse

const ROOT = new URL('../src', import.meta.url).pathname
const files = []
;(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(js|jsx)$/.test(n)) files.push(p)
  }
})(ROOT)

const GLOBALS = new Set([
  'window', 'document', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Set', 'Map', 'WeakMap', 'Promise',
  'Error', 'RegExp', 'Symbol', 'Intl', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'fetch', 'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams', 'FormData', 'Image',
  'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt', 'requestAnimationFrame', 'crypto', 'atob', 'btoa',
  'undefined', 'NaN', 'Infinity', 'globalThis', 'structuredClone', 'TextEncoder', 'TextDecoder', 'AbortController',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'HTMLElement',
  'process', 'module', 'require', 'exports', '__dirname', 'arguments', 'Uint8Array', 'ArrayBuffer', 'BigInt',
])

// 画面用の入口ファイルは実ブラウザ専用（location 等）なので対象外
const SKIP = ['__smoke.jsx']
let bad = 0
for (const f of files.filter(x => !SKIP.some(s => x.endsWith(s)))) {
  const code = readFileSync(f, 'utf8')
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] })
  traverse(ast, {
    Program(path) {
      const seen = new Set()
      path.traverse({
        ReferencedIdentifier(p) {
          const name = p.node.name
          if (GLOBALS.has(name) || seen.has(name)) return
          if (p.scope.hasBinding(name, true)) return
          if (/^[A-Z]/.test(name) && p.parentPath.isJSXOpeningElement()) { /* JSX の要素名も対象にする */ }
          seen.add(name)
          bad++
          console.log(`${f.replace(ROOT, 'src')}:${p.node.loc.start.line}  未定義の参照: ${name}`)
        },
      })
    },
  })
}
console.log(bad ? `\n未定義の参照 ${bad} 件` : '\n未定義の参照は見つかりませんでした（' + files.length + ' ファイル）')
process.exit(bad ? 1 : 0)
