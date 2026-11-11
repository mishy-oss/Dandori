import { defineConfig } from 'vite'
import { execFileSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

import { cloudflare } from '@cloudflare/vite-plugin'

/** ビルド対象のコミットを取得する。Git情報のないローカル環境では更新内容だけを利用不可にする。 */
function buildCommit(): string {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return /^[a-f0-9]{40}$/.test(commit) ? commit : ''
  } catch {
    return ''
  }
}

const commit = buildCommit()

export default defineConfig({
  define: { 'import.meta.env.VITE_APP_COMMIT': JSON.stringify(commit) },
  plugins: [
    {
      name: 'dandori-version',
      /** 最新デプロイのSHAをネットワークから確認できるよう、クライアントの公開ファイルへ出力する。 */
      generateBundle() {
        if (this.environment.name === 'client') {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ commit }) })
        }
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.js',
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Dandori',
        short_name: 'Dandori',
        description: '個人用スプリント管理 + 時間軸タイムライン',
        lang: 'ja',
        display: 'standalone',
        start_url: '/?source=pwa',
        scope: '/',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
      },
      devOptions: { enabled: false },
    }),
    cloudflare(),
  ],
})
