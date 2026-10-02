import React, { useEffect, useRef, useState } from 'react'
import { AI_ENABLED, supabase } from './supabase-client'
import { isHaqAiGreeting } from '../supabase/functions/seller-ai/haq-ai-context.js'
import './haq-ai.css'

const STARTERS = ['Cari peluang barang', 'Cek barang', 'Bantu listing', 'Analisis toko']

function localGreetingReply() {
  return 'Halo! Aku HAQ AI, asisten untuk kebutuhan toko Haqlooks. Aku bisa bantu cek barang, Temuan, listing, penjualan, dan operasional toko.'
}

async function invokeHaqAi(body) {
  const { data, error } = await supabase.functions.invoke('seller-ai', { body })
  if (error) {
    let message = error.message
    let code = ''
    try {
      const response = error.context
      const payload = await (typeof response?.clone === 'function' ? response.clone() : response).json()
      message = payload?.message || payload?.error || message
      code = payload?.error || ''
    } catch { /* Retain the SDK's safe fallback message. */ }
    throw Object.assign(new Error(message || 'HAQ AI belum bisa menjawab.'), { code })
  }
  if (!data?.ok) throw Object.assign(new Error(data?.message || 'HAQ AI belum bisa menjawab.'), { code: data?.error || '' })
  return data
}

export default function HaqAIChatPage({ onStartResearch = () => {} }) {
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retryText, setRetryText] = useState('')
  const [researchSuggestion, setResearchSuggestion] = useState(null)
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const inFlight = useRef(false)

  useEffect(() => {
    if (!messages.length && !loading) return
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, loading])

  async function send(rawText, { retry = false } = {}) {
    const text = String(rawText || '').trim().slice(0, 1000)
    if (!text || inFlight.current) return

    if (!retry) {
      setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', content: text }])
    }
    setError('')
    setRetryText('')
    setResearchSuggestion(null)

    if (isHaqAiGreeting(text)) {
      setMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: 'assistant', content: localGreetingReply() }])
      return
    }
    if (!AI_ENABLED) {
      setError('HAQ AI belum diaktifkan di environment ini. Barang, Temuan, dan aktivitas toko tetap bisa dikelola.')
      setRetryText(text)
      return
    }
    if (!supabase) {
      setError('Koneksi HAQLOOKS belum tersedia. Periksa kembali setelah tersambung.')
      setRetryText(text)
      return
    }

    inFlight.current = true
    setLoading(true)
    try {
      const data = await invokeHaqAi({
        feature: 'HUNTER_CHAT',
        assistant_mode: 'haq_ai_v1',
        ...(sessionId ? { session_id: sessionId } : {}),
        message: text,
        request_id: crypto.randomUUID(),
      })
      if (data.session_id) setSessionId(data.session_id)
      setMessages((current) => [...current, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.assistant_message || 'Aku belum mendapat jawaban yang cukup. Coba tanya lebih spesifik.',
      }])
      if (data.research_suggestion?.needed) setResearchSuggestion(data.research_suggestion)
    } catch (caught) {
      setError(caught?.message || 'HAQ AI sedang tidak tersedia. Coba lagi sebentar.')
      setRetryText(text)
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  function submit(event) {
    event.preventDefault()
    const text = question
    setQuestion('')
    void send(text)
  }

  function useStarter(prompt) {
    setQuestion(prompt)
    inputRef.current?.focus()
  }

  return <section className="haq-ai-chat" aria-label="Percakapan HAQ AI">
    <div className="haq-ai-intro">
      <span>ASISTEN TOKO</span>
      <p>HAQ AI difokuskan untuk kebutuhan toko HAQLOOKS.</p>
    </div>

    <div className="haq-ai-transcript" aria-live="polite" aria-relevant="additions text" aria-busy={loading}>
      {!messages.length && <div className="haq-ai-empty">
        <div className="haq-ai-welcome"><span className="haq-ai-mark" aria-hidden="true">H</span><div><strong>Ada yang bisa kubantu?</strong><p>Tanya soal barang, Temuan, listing, penjualan, atau operasional toko.</p></div></div>
        <div className="haq-ai-starters" aria-label="Contoh pertanyaan">
          {STARTERS.map((starter) => <button type="button" key={starter} onClick={() => useStarter(starter)}>{starter}<span aria-hidden="true">↗</span></button>)}
        </div>
      </div>}

      {messages.map((message) => <article key={message.id} className={`haq-ai-message ${message.role}`}>
        <small>{message.role === 'assistant' ? 'HAQ AI' : 'KAMU'}</small>
        <p>{message.content}</p>
      </article>)}
      {loading && <div className="haq-ai-thinking" role="status"><span className="haq-ai-spinner" /> HAQ AI sedang menyusun jawaban…</div>}
      {researchSuggestion && <aside className="haq-ai-research-prompt" role="status">
        <div><strong>Riset pasar mungkin membantu</strong><p>{researchSuggestion.reason || 'Gunakan riset destinasi dengan sumber web terbaru.'} Tinjau rencana dan konfirmasi sebelum riset dijalankan.</p></div>
        <button type="button" onClick={onStartResearch}>Mulai Research</button>
      </aside>}
      {error && <div className="haq-ai-error" role="alert"><span>{error}</span>{retryText && <button type="button" disabled={loading} onClick={() => void send(retryText, { retry: true })}>Coba lagi</button>}</div>}
      <div ref={endRef} />
    </div>

    {!AI_ENABLED && <p className="haq-ai-disabled" role="status">AI belum diaktifkan untuk environment ini. Percakapan sapaan tetap tersedia; tidak ada permintaan AI yang dikirim.</p>}
    <form className="haq-ai-composer" onSubmit={submit} aria-busy={loading}>
      <label className="sr-only" htmlFor="haq-ai-question">Tulis pesan untuk HAQ AI</label>
      <textarea ref={inputRef} id="haq-ai-question" value={question} maxLength={1000} rows={2} placeholder="Tanya kebutuhan toko…" disabled={loading} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(event) }
      }} />
      <button type="submit" disabled={loading || !question.trim()} aria-label={loading ? 'HAQ AI sedang membalas' : 'Kirim pesan'}>{loading ? <><span className="haq-ai-spinner" /> Membalas</> : 'Kirim ↑'}</button>
      <small>Enter untuk kirim · Shift+Enter untuk baris baru</small>
    </form>
  </section>
}
