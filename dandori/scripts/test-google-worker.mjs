import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { build } from 'vite'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

const root = fileURLToPath(new URL('..', import.meta.url))
await build({ root, configFile: false, build: { outDir: '.wrangler/google-account-tests', emptyOutDir: false,
  lib: { entry: fileURLToPath(new URL('../worker/testing/accountRuntime.ts', import.meta.url)), fileName: 'runtime', formats: ['es'] }, rolldownOptions: { external: ['cloudflare:workers'] } } })
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: fileURLToPath(new URL('../.wrangler/google-account-tests/runtime.js', import.meta.url)), compatibilityDate: '2026-10-06', host: '127.0.0.1', port: 0,
  bindings: { APP_ORIGIN: 'http://localhost', GOOGLE_CLIENT_ID: 'local-test', GOOGLE_CLIENT_SECRET: 'local-test', GOOGLE_ALLOWED_EMAILS: 'alice@example.com', GOOGLE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') },
  durableObjects: { ACCOUNT_DATA: { className: 'TestAccountData', useSQLite: true }, ACCOUNT_SESSIONS: { className: 'AccountSession', useSQLite: true } },
}))
try {
  const response = await mf.dispatchFetch('http://localhost/__runtime-test')
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(Object.keys(result).length, 8)
  for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, name)
  console.log('Google account Worker runtime: 8 checks passed')
} finally { await mf.dispose() }
