import React, { useState } from 'react'
import { supabase } from './supabase-client'

function go(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function StaffLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setMessage('')
    if (!supabase) {
      setMessage('Akses staf belum dikonfigurasi di lingkungan ini.')
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setMessage(error.message || 'Tidak dapat masuk. Periksa email dan kata sandi.')
        return
      }
      go('/seller')
    } catch {
      setMessage('Tidak dapat terhubung. Periksa koneksi lalu coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="staff-auth-page">
    <section className="staff-auth-brand" aria-label="HAQLOOKS">
      <a className="staff-auth-wordmark" href="/" onClick={(event) => { event.preventDefault(); go('/') }}>HAQLOOKS</a>
      <div className="staff-auth-visual"><img src="/mascot-latest.png" alt="" /><p>PRE-OWNED SNEAKERS.<br />NEW STORIES.</p></div>
    </section>
    <section className="staff-auth-panel">
      <div className="staff-auth-content">
        <span className="staff-auth-kicker">HAQLOOKS / Staff Panel</span>
        <h1>Masuk ke Panel</h1>
        <p className="staff-auth-lede">Gunakan akun staf HAQLOOKS untuk melanjutkan.</p>
        <form onSubmit={submit}>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
          <label>Kata sandi<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
          {message && <div className="staff-auth-error" role="alert">{message}</div>}
          <button type="submit" className="staff-auth-submit" disabled={busy}>{busy ? 'Memeriksa…' : 'Masuk'}</button>
        </form>
        <a className="staff-auth-back" href="/" onClick={(event) => { event.preventDefault(); go('/') }}>Kembali ke etalase</a>
      </div>
    </section>
  </main>
}
