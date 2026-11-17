import { expect, it } from 'vitest'
import { cookie, digest, randomToken, readLimitedJson, seal, trustedOrigin, unseal } from './accountSecurity'

it('encrypts Google tokens with random IVs and detects tampering or an incorrect key', async () => {
  const key = randomToken(), value = { refreshToken: 'private-refresh-token' }
  const a = await seal(value, key), b = await seal(value, key)
  expect(a).not.toBe(b)
  expect(a).not.toContain(value.refreshToken)
  expect(await unseal(a, key)).toEqual(value)
  await expect(unseal(a, randomToken())).rejects.toThrow()
  const [iv, data] = a.split('.')
  await expect(unseal(`${iv}.${data[0] === 'A' ? 'B' : 'A'}${data.slice(1)}`, key)).rejects.toThrow()
})
it('creates opaque tokens, PKCE SHA256 challenges and HttpOnly same-site cookies', async () => {
  const token = randomToken()
  expect(token).toMatch(/^[\w-]{43}$/)
  expect(await digest('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  expect(cookie('session', token, 60, 'https://example.com')).toContain('HttpOnly; SameSite=Lax; Max-Age=60; Secure')
  expect(cookie('session', token, 60, 'http://localhost:5173')).not.toContain('Secure')
})
it('rejects foreign origins and oversized streamed JSON even without Content-Length', async () => {
  expect(trustedOrigin(new Request('https://app.test/api', { method: 'POST', headers: { Origin: 'https://evil.test' } }), 'https://app.test')).toBe(false)
  expect(trustedOrigin(new Request('https://app.test/api', { method: 'POST', headers: { Origin: 'https://app.test' } }), 'https://app.test')).toBe(true)
  const request = new Request('https://app.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(100) }) })
  await expect(readLimitedJson(request, 50)).rejects.toThrow('上限')
})
