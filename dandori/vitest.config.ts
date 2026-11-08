import { defineConfig } from 'vitest/config'

// DBと画面の単体テストではCloudflareの開発サーバーを起動しない。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
})
