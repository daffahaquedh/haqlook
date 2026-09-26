import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AI_ENABLED, supabase } from './supabase-client'
import { prepareProductPhoto } from './seller-photos'
import { detectHunterCategories, detectHunterDestination, filterHunterTargets, HUNTER_DESTINATIONS, parseHunterBudget } from './hunter-utils'
import { moneyIdr } from './seller-utils'
import './hunter.css'

const OPENING = 'Hari ini mau hunting ke mana?'

function errorMessage(error, fallback = 'Belum berhasil. Coba lagi sebentar.') {
  const raw = String(error?.message || error || '')
  if (/AI_MONTHLY_BUDGET_REACHED|budget/i.test(raw)) return 'Budget AI bulanan sudah tercapai. Inventory dan sourcing manual tetap bisa dipakai.'
  if (/AI_NOT_CONFIGURED/i.test(raw)) return 'AI belum dikonfigurasi di server. Sourcing manual tetap tersedia.'
  if (/AI_TIMEOUT|timed out|timeout/i.test(raw)) return 'Permintaan AI terlalu lama. Brief tersimpan tetap bisa dipakai; coba lagi sebentar.'
  if (/AI_RATE_LIMITED|rate limit/i.test(raw)) return 'AI sedang menerima terlalu banyak permintaan. Coba lagi sebentar.'
  if (/AI_INVALID_RESPONSE/i.test(raw)) return 'Jawaban AI belum terbaca dengan benar. Coba ulangi tanpa mengubah data inventory.'
  if (/IMAGE_UNAVAILABLE/i.test(raw)) return 'Foto tidak bisa dianalisis. Pilih JPEG, PNG, atau WebP lain.'
  return raw || fallback
}

async function callHunterFunction(body) {
  const { data, error } = await supabase.functions.invoke('seller-ai', { body })
  if (error) {
    let message = error.message
    try {
      const response = error.context
      const payload = await (typeof response?.clone === 'function' ? response.clone() : response).json()
      message = payload?.message || payload?.error || message
    } catch { /* Keep the SDK error if there is no readable response body. */ }
    throw new Error(message || 'Hunter request failed.')
  }
  if (!data?.ok) throw new Error(data?.message || data?.error || 'AI Hunter request failed.')
  return data
}

function moneyRange(low, high, currency = 'IDR') {
  if (low == null || high == null) return 'Belum ada referensi harga publik yang cukup.'
  if (currency === 'IDR') return `${moneyIdr(low)}–${moneyIdr(high)}`
  return `${Number(low).toLocaleString()}–${Number(high).toLocaleString()} ${currency}`
}

function sourceFor(url, sources) {
  return (sources || []).find((source) => source.url === url) || { url, title: new URL(url).hostname }
}

async function resizeHunterPhoto(file) {
  let bitmap
  let objectUrl
  try {
    if (typeof createImageBitmap === 'function') {
      try { bitmap = await createImageBitmap(file) } catch { /* Safari may require the Image decoder. */ }
    }
    if (!bitmap) {
      objectUrl = URL.createObjectURL(file)
      const image = new Image()
      bitmap = await new Promise((resolve, reject) => {
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('The browser could not read this image.'))
        image.src = objectUrl
      })
    }
    const scale = Math.min(1, 1280 / Math.max(bitmap.width || bitmap.naturalWidth, bitmap.height || bitmap.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((bitmap.width || bitmap.naturalWidth) * scale))
    canvas.height = Math.max(1, Math.round((bitmap.height || bitmap.naturalHeight) * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Browser image processing is unavailable.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78))
    if (!blob || blob.size > 1_500_000) throw new Error('Foto masih terlalu besar untuk dianalisis. Pilih foto lain.')
    return blob
  } finally {
    bitmap?.close?.()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

async function photoDataUrl(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) binary += String.fromCharCode(...bytes.subarray(index, index + step))
  return `data:image/jpeg;base64,${btoa(binary)}`
}

export function HunterChatPage() {
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState([])
  const [brief, setBrief] = useState(null)
  const [destination, setDestination] = useState('')
  const [categoryFocus, setCategoryFocus] = useState([])
  const [budgetIdr, setBudgetIdr] = useState(null)
  const [internationalOnly, setInternationalOnly] = useState(false)
  const [isHere, setIsHere] = useState(false)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('')
  const [error, setError] = useState('')
  const [sourceCandidates, setSourceCandidates] = useState({})
  const [notSeen, setNotSeen] = useState({})
  const [focusedTargetIds, setFocusedTargetIds] = useState([])
  const [aiBudget, setAiBudget] = useState(null)
  const [checkTarget, setCheckTarget] = useState(null)
  const [itemCheck, setItemCheck] = useState(null)
  const [checkFiles, setCheckFiles] = useState([])
  const [checkPrice, setCheckPrice] = useState('')
  const [checkBusy, setCheckBusy] = useState(false)
  const [checkError, setCheckError] = useState('')
  const chatEnd = useRef(null)

  useEffect(() => { void initialize() }, [])
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages.length, loading])

  async function initialize() {
    if (!supabase) { setError('Supabase tidak dikonfigurasi untuk environment ini.'); return }
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) { setError('Sesi seller tidak tersedia. Silakan login ulang.'); return }
    void refreshAiBudget()
    const { data, error: sessionError } = await supabase.from('hunter_sessions').select('id,destination,category_focus,budget_idr,is_here,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(20)
    if (sessionError) { setError(errorMessage(sessionError, 'Sesi Hunter belum bisa dimuat.')); return }
    if (!data?.length) {
      const { data: created, error: createError } = await supabase.from('hunter_sessions').insert({ user_id: user.id }).select('id,destination,category_focus,budget_idr,is_here,updated_at').single()
      if (createError) { setError(errorMessage(createError, 'Sesi Hunter belum bisa dibuat.')); return }
      setSessions([created]); await selectSession(created); return
    }
    setSessions(data)
    await selectSession(data[0])
  }

  async function refreshAiBudget() {
    if (!supabase) return
    const { data } = await supabase.rpc('seller_ai_usage_summary')
    if (data) setAiBudget(data)
  }

  async function selectSession(session) {
    setSessionId(session.id); setDestination(session.destination || ''); setCategoryFocus(session.category_focus || []); setBudgetIdr(session.budget_idr || null); setIsHere(Boolean(session.is_here)); setError('')
    const { data, error: messagesError } = await supabase.from('hunter_messages').select('id,role,content,message_kind,metadata,created_at').eq('session_id', session.id).order('created_at', { ascending: true }).limit(100)
    if (messagesError) { setError(errorMessage(messagesError)); setMessages([]); return }
    setMessages(data || [])
    const latestBriefMessage = [...(data || [])].reverse().find((item) => item.message_kind === 'brief' && item.metadata?.brief_id)
    if (latestBriefMessage) {
      const { data: briefRecord } = await supabase.from('hunter_briefs').select('id,destination,brief_json,citations,created_at,expires_at').eq('id', latestBriefMessage.metadata.brief_id).maybeSingle()
      setBrief(briefRecord ? { id: briefRecord.id, destination: briefRecord.destination, brief: briefRecord.brief_json, citations: briefRecord.citations || [], created_at: briefRecord.created_at, expires_at: briefRecord.expires_at } : null)
      if (briefRecord) {
        const { data: saved } = await supabase.from('sourcing_candidates').select('id,title,status,hunter_target_key').eq('hunter_brief_id', briefRecord.id).not('hunter_target_key', 'is', null)
        setSourceCandidates(Object.fromEntries((saved || []).map((candidate) => [candidate.hunter_target_key, candidate])))
      } else setSourceCandidates({})
    } else { setBrief(null); setSourceCandidates({}) }
  }

  async function newSession() {
    if (!supabase) return
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Sesi seller tidak tersedia. Silakan login ulang.'); return }
    const { data, error: createError } = await supabase.from('hunter_sessions').insert({ user_id: user.id }).select('id,destination,category_focus,budget_idr,is_here,updated_at').single()
    if (createError) { setError(errorMessage(createError)); return }
    setSessions((current) => [data, ...current].slice(0, 20)); setBrief(null); setMessages([]); setDestination(''); setCategoryFocus([]); setBudgetIdr(null); setIsHere(false); setNotSeen({}); await selectSession(data)
  }

  async function updateSession(values) {
    if (!sessionId || !supabase) return
    const next = { ...values, updated_at: new Date().toISOString() }
    const { error: updateError } = await supabase.from('hunter_sessions').update(next).eq('id', sessionId)
    if (updateError) setError(errorMessage(updateError, 'Perubahan konteks belum tersimpan.'))
    else setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, ...next } : session))
  }

  async function sendMessage(text, { destinationOverride = '', forceRefresh = false } = {}) {
    const trimmed = String(text || '').trim().slice(0, 1000)
    if (!trimmed || loading) return
    if (!AI_ENABLED) { setError('AI Hunter belum diaktifkan di environment ini. Coba lagi setelah backend AI disiapkan.'); return }
    if (!supabase || !sessionId) { setError('Sesi belum siap. Muat ulang Seller Panel lalu coba lagi.'); return }
    setError('')
    const detected = destinationOverride || detectHunterDestination(trimmed)
    const nextDestination = detected || destination
    const budget = parseHunterBudget(trimmed)
    const categories = detectHunterCategories(trimmed)
    const wantsInternational = /luar negeri|dijual ke luar|overseas|international|internasional/i.test(trimmed)
    const nextBudget = budget || budgetIdr
    const nextCategories = categories.length ? categories : categoryFocus
    const nextInternational = wantsInternational || internationalOnly
    if (detected) setDestination(detected)
    if (budget) setBudgetIdr(budget)
    if (categories.length) setCategoryFocus(categories)
    if (wantsInternational) setInternationalOnly(true)
    await updateSession({ ...(detected ? { destination: detected } : {}), ...(budget ? { budget_idr: budget } : {}), ...(categories.length ? { category_focus: categories } : {}) })
    const currentBriefDestination = brief?.destination || brief?.brief?.destination_name || ''
    const feature = forceRefresh ? 'HUNTER_REFRESH' : nextDestination && (!brief || currentBriefDestination.toLowerCase() !== nextDestination.toLowerCase()) ? 'HUNTER_DESTINATION_BRIEF' : 'HUNTER_CHAT'
    setMessages((current) => [...current, { id: `local-user-${Date.now()}`, role: 'user', content: trimmed, message_kind: 'chat', created_at: new Date().toISOString() }])
    setLoading(true); setLoadingLabel(feature === 'HUNTER_CHAT' ? 'Menyiapkan jawaban dari brief yang sudah ada…' : 'Mencari referensi publik terbaru…')
    try {
      const data = await callHunterFunction({
        feature,
        session_id: sessionId,
        message: trimmed,
        destination: nextDestination,
        category_focus: nextCategories,
        budget_idr: nextBudget,
        international_only: nextInternational,
      })
      if (data.session_id && data.session_id !== sessionId) setSessionId(data.session_id)
      if (data.destination) setDestination(data.destination)
      if (data.brief) setBrief(data.brief)
      if (Array.isArray(data.category_focus)) setCategoryFocus(data.category_focus)
      if (data.budget_idr != null) setBudgetIdr(data.budget_idr)
      if (Array.isArray(data.focused_target_ids)) setFocusedTargetIds(data.focused_target_ids)
      setMessages((current) => [...current, { id: `local-assistant-${Date.now()}`, role: 'assistant', content: data.assistant_message || data.reply || 'Selesai.', message_kind: data.brief ? 'brief' : 'chat', metadata: data.brief_id ? { brief_id: data.brief_id } : {}, created_at: new Date().toISOString() }])
      if (data.session_id) setSessions((current) => current.map((session) => session.id === data.session_id ? { ...session, updated_at: new Date().toISOString(), destination: data.destination || session.destination } : session))
    } catch (caught) { setError(errorMessage(caught, 'AI Hunter sedang tidak tersedia.')); }
    finally { setLoading(false); setLoadingLabel(''); void refreshAiBudget() }
  }

  const visibleTargets = useMemo(() => filterHunterTargets(brief?.brief, { categories: categoryFocus, budgetIdr, internationalOnly }).filter((target) => !focusedTargetIds.length || focusedTargetIds.includes(target.target_id)), [brief, categoryFocus, budgetIdr, internationalOnly, focusedTargetIds])

  async function toggleHere() {
    const next = !isHere; setIsHere(next); await updateSession({ is_here: next })
  }

  async function saveTarget(target, status = 'WATCHING') {
    if (!supabase || !brief?.id) return null
    const existing = sourceCandidates[target.target_id]
    if (existing) return existing
    const idrRange = target.resale_currency === 'IDR'
    const notes = [target.why_search, target.market_evidence_summary, `Quick check: ${(target.inspection_checklist || []).join('; ')}`, `Sources: ${(target.source_urls || []).join(' ')}`].filter(Boolean).join('\n')
    const payload = {
      title: target.item_name,
      brand: null,
      category: target.category || null,
      source_platform: destination || brief.destination,
      source_url: null,
      seller_asking_price: 0,
      estimated_resale_min: idrRange ? Number(target.resale_low || 0) : 0,
      estimated_resale_max: idrRange ? Number(target.resale_high || 0) : 0,
      max_buy_price: Number(target.max_buy_price_idr || 0),
      condition: null,
      authenticity_risk: target.authenticity_risk || 'Authenticity not verified; manual verification required.',
      opportunity_score: null,
      notes,
      status,
      hunter_brief_id: brief.id,
      hunter_target_key: target.target_id,
      checked_at: status === 'CHECK' ? new Date().toISOString() : null,
    }
    const { data, error: insertError } = await supabase.from('sourcing_candidates').insert(payload).select('id,title,status').single()
    if (insertError) {
      if (insertError.code === '23505') {
        const { data: existing } = await supabase.from('sourcing_candidates').select('id,title,status').eq('hunter_brief_id', brief.id).eq('hunter_target_key', target.target_id).maybeSingle()
        if (existing) { setSourceCandidates((current) => ({ ...current, [target.target_id]: existing })); return existing }
      }
      setError(errorMessage(insertError, 'Kandidat belum tersimpan ke Sourcing.')); return null
    }
    setSourceCandidates((current) => ({ ...current, [target.target_id]: data }))
    return data
  }

  async function markNotSeen(target) {
    setNotSeen((current) => ({ ...current, [target.target_id]: !current[target.target_id] }))
  }

  function submitInput(event) { event.preventDefault(); const text = question; setQuestion(''); void sendMessage(text) }

  const age = brief?.created_at ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(brief.created_at)) : ''

  return <div className="hunter-page">
    <header className="hunter-page-head"><div><span className="hunter-eyebrow">HAQLOOKS SOURCING COPILOT</span><h1>AI Hunter</h1><p>Asisten sourcing Haqlooks · Haqlooks sourcing assistant</p></div><div className="hunter-session-actions"><label className="sr-only" htmlFor="hunter-session">Pilih sesi Hunter</label><select id="hunter-session" value={sessionId} onChange={(event) => { const selected = sessions.find((item) => item.id === event.target.value); if (selected) void selectSession(selected) }}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.destination || 'Percakapan baru'}</option>)}</select><button className="hunter-icon-button" type="button" onClick={() => void newSession()} aria-label="Mulai percakapan baru">＋</button></div></header>
    {!AI_ENABLED && <div className="hunter-disabled" role="status"><strong>AI belum diaktifkan di environment ini.</strong><span>Inventory dan candidate manual tetap tersedia. Backend Hunter akan aktif setelah flag AI pada deployment diizinkan.</span></div>}
    {Number(aiBudget?.percentage || 0) >= 90 && <div className="hunter-budget-warning" role="status"><strong>{Number(aiBudget?.percentage || 0) >= 100 ? 'AI monthly budget reached' : 'Budget AI hampir tercapai'}</strong><span>{moneyIdr(aiBudget?.used || 0)} dari {moneyIdr(aiBudget?.budget || 100000)} terpakai. Sourcing manual tetap tersedia.</span></div>}
    {error && <div className="hunter-error" role="alert">{error}</div>}
    <section className="hunter-chat" aria-label="Percakapan AI Hunter">
      <div className="hunter-bubble assistant"><small>HAQLOOKS HUNTER</small><p>{OPENING}</p><p className="hunter-translation">Where are you sourcing today?</p></div>
      {!messages.length && <div className="hunter-quick-destinations" aria-label="Quick destinations">{HUNTER_DESTINATIONS.map((place) => <button type="button" key={place.value} disabled={!AI_ENABLED || loading} onClick={() => void sendMessage(`Hari ini mau hunting ke ${place.label}. Apa yang bagus dicari?`, { destinationOverride: place.value })}>{place.label}</button>)}<button type="button" disabled={!AI_ENABLED || loading} onClick={() => setQuestion('Hari ini aku mau hunting ke ')}>＋ Tempat lain / Other</button></div>}
      {messages.map((message) => <article className={`hunter-bubble ${message.role === 'assistant' ? 'assistant' : 'seller'}`} key={message.id}><small>{message.role === 'assistant' ? 'HAQLOOKS HUNTER' : 'KAMU / YOU'}</small><p>{message.content}</p></article>)}
      {loading && <div className="hunter-bubble assistant hunter-thinking" role="status"><span className="hunter-pulse" />{loadingLabel}</div>}
      <div ref={chatEnd} />
    </section>
    {brief && <HunterBriefView briefRecord={brief} age={age} isHere={isHere} visibleTargets={visibleTargets} categories={categoryFocus} budgetIdr={budgetIdr} internationalOnly={internationalOnly} onRefresh={() => void sendMessage(`Perbarui research untuk ${destination || brief.destination}`, { destinationOverride: destination || brief.destination, forceRefresh: true })} onToggleHere={() => void toggleHere()} onSaveTarget={saveTarget} sourceCandidates={sourceCandidates} notSeen={notSeen} onNotSeen={markNotSeen} onCheck={(target) => { setCheckTarget(target); setCheckFiles([]); setCheckPrice(''); setItemCheck(null); setCheckError('') }} />}
    <form className="hunter-composer" onSubmit={submitInput}><label className="sr-only" htmlFor="hunter-question">Tulis pesan ke AI Hunter</label><textarea id="hunter-question" rows="2" maxLength="1000" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitInput(event) } }} placeholder="Ceritakan rencana hunting, budget, atau fokus barang…" disabled={!AI_ENABLED || loading} /><button className="hunter-send" type="submit" disabled={!AI_ENABLED || loading || !question.trim()} aria-label="Kirim pesan">{loading ? '…' : 'Kirim ↑'}</button></form>
    {brief && <div className="hunter-suggested-filters"><button type="button" onClick={() => { setCategoryFocus(['T-shirts', 'Jackets']); void updateSession({ category_focus: ['T-shirts', 'Jackets'] }) }}>Kaos + jaket</button><button type="button" onClick={() => { setBudgetIdr(300000); void updateSession({ budget_idr: 300000 }) }}>Modal Rp300k</button><button type="button" onClick={() => setInternationalOnly((current) => !current)}>{internationalOnly ? 'Tampilkan semua' : 'Mudah dijual ke luar'}</button><button type="button" onClick={() => { setCategoryFocus([]); setBudgetIdr(null); setInternationalOnly(false); setFocusedTargetIds([]); void updateSession({ category_focus: [], budget_idr: null }) }}>Reset filter</button></div>}
    {checkTarget && <HunterItemCheckSheet target={checkTarget} destination={destination} sessionId={sessionId} briefId={brief?.id} files={checkFiles} setFiles={setCheckFiles} askingPrice={checkPrice} setAskingPrice={setCheckPrice} result={itemCheck} setResult={setItemCheck} busy={checkBusy} setBusy={setCheckBusy} error={checkError} setError={setCheckError} onClose={() => setCheckTarget(null)} onSaveCandidate={async (result) => { const created = await saveTarget({ ...checkTarget, authenticity_risk: result.authenticity_risk }, result.verdict === 'CHECK' ? 'CHECK' : 'WATCHING'); if (created) setCheckTarget(null) }} />}
  </div>
}

function HunterBriefView({ briefRecord, age, isHere, visibleTargets, categories, budgetIdr, internationalOnly, onRefresh, onToggleHere, onSaveTarget, sourceCandidates, notSeen, onNotSeen, onCheck }) {
  const { brief, citations = [] } = briefRecord
  const sections = [
    ['priority', '🔥 Prioritas utama', 'TOP PRIORITY'],
    ['buy_if_cheap', '✅ Aman dibeli jika murah', 'SAFE IF CHEAP'],
    ['wildcard', '🎯 Wildcard', 'WILDCARD'],
    ['caution', '⚠️ Hati-hati', 'CAUTION'],
    ['avoid', '❌ Jangan dikejar', 'SKIP'],
  ]
  const visibleIds = new Set(visibleTargets.map((target) => target.target_id))
  const visibleCount = visibleTargets.length
  return <section className="hunter-brief" aria-label="Destination hunting brief">
    <header className="hunter-brief-head"><div><span>HUNTING BRIEF</span><h2>{brief.destination_name || briefRecord.destination}</h2><p>Perkiraan sourcing · ketersediaan stok fisik tidak diverifikasi</p></div><div className="hunter-updated"><small>UPDATED / DIPERBARUI</small><strong>{age}</strong><small>{briefRecord.expires_at && new Date(briefRecord.expires_at) > new Date() ? 'Cache aktif 12 jam' : 'Cache kedaluwarsa'}</small></div></header>
    <div className="hunter-stock-caution"><b>SUMBER PUBLIK TERVERIFIKASI · STOK FISIK ADALAH PERKIRAAN</b><span>{brief.uncertainty_notice || 'Sumber publik mendukung riset pasar; ketersediaan di lokasi hari ini tidak terverifikasi.'}</span></div>
    {(categories.length > 0 || budgetIdr || internationalOnly) && <div className="hunter-filter-note">Menampilkan {visibleCount} target dari riset yang sama{categories.length ? ` · ${categories.join(', ')}` : ''}{budgetIdr ? ` · budget ${moneyIdr(budgetIdr)}` : ''}{internationalOnly ? ' · international fit' : ''}. Tidak melakukan web search baru.</div>}
    {isHere && <div className="hunter-on-location"><span>MODE DI LOKASI / I’M HERE</span><p>Checklist cepat saat membongkar barang. Pilih “Ditemukan” untuk menyimpan ke Sourcing dengan status CHECK.</p></div>}
    {sections.map(([key, title, label]) => {
      const targets = (brief.sections?.[key] || []).filter((target) => visibleIds.has(target.target_id))
      if (!targets.length) return null
      return <section className="hunter-target-section" key={key}><h3>{title}<small>{label}</small></h3><div className="hunter-target-list">{targets.map((target, index) => <HunterTargetCard key={target.target_id || `${key}-${index}`} target={target} citations={citations} section={key} isHere={isHere} saved={sourceCandidates[target.target_id]} notSeen={Boolean(notSeen[target.target_id])} onSave={() => onSaveTarget(target)} onFound={() => onSaveTarget(target, 'CHECK')} onNotSeen={() => onNotSeen(target)} onCheck={() => onCheck(target)} />)}</div></section>
    })}
    {!visibleCount && <div className="hunter-empty">Tidak ada target di brief yang cocok dengan filter ini. Coba longgarkan budget/kategori, atau minta fokus lain.</div>}
    {!!brief.new_discoveries?.length && <section className="hunter-discoveries"><h3>Barang yang mungkin belum kamu kenal<small>ITEMS WORTH LEARNING</small></h3><div className="hunter-discovery-list">{brief.new_discoveries.slice(0, 3).map((item, index) => <article key={`${item.name}-${index}`}><strong>{item.name}</strong><p>{item.what_it_is}</p><div><b>Ciri / quick ID:</b> {item.quick_identification}</div><div><b>Tag:</b> {(item.tags_to_check || []).join(', ') || '—'}</div><div><b>Fake risk:</b> {item.fake_risk}</div><div><b>Demand:</b> {item.demand_signal}</div><p>{item.why_learn}</p><SourceLinks urls={item.source_urls} citations={citations} /></article>)}</div></section>}
    {!!brief.internal_insights?.length && <section className="hunter-internal-insights"><h3>Insight Haqlooks / Internal signal</h3>{brief.internal_insights.map((insight, index) => <p key={index}>{insight}</p>)}</section>}
    <details className="hunter-sources"><summary>Sumber riset / Research sources ({citations.length})</summary><SourceLinks urls={citations.map((item) => item.url)} citations={citations} /></details>
    <footer className="hunter-brief-actions"><button className={`hunter-here-button ${isHere ? 'active' : ''}`} type="button" onClick={onToggleHere}>{isHere ? '✓ Saya Sudah Sampai / I’m Here' : 'Saya Sudah Sampai / I’m Here'}</button><button type="button" className="hunter-refresh-button" onClick={onRefresh}>Perbarui Data / Refresh Research</button></footer>
  </section>
}

function HunterTargetCard({ target, citations, section, isHere, saved, notSeen, onSave, onFound, onNotSeen, onCheck }) {
  const sourceUrls = Array.isArray(target.source_urls) ? target.source_urls : []
  return <article className="hunter-target-card">
    <div className="hunter-target-title"><span>{target.category || 'Fashion'} · PERKIRAAN / SOURCING HYPOTHESIS</span><h4>{target.item_name}</h4></div>
    <p>{target.why_search}</p>
    <div className="hunter-cheat-sheet"><div><b>Ciri cepat / Quick ID</b><span>{target.quick_identification}</span></div><div><b>Tag / detail penting</b><span>{(target.tags_and_details || []).join(' · ') || 'Periksa label dan konstruksi.'}</span></div><div><b>Size / ukuran utama</b><span>{(target.preferred_size || []).join(', ') || 'Ikuti permintaan lokal.'}</span></div><div><b>Varian utama</b><span>{(target.preferred_variants || []).join(', ') || 'Pilih kondisi terbaik.'}</span></div></div>
    <div className="hunter-price-grid"><div><small>IDEAL BUY / BELI IDEAL</small><strong>{moneyRange(target.ideal_buy_low_idr, target.ideal_buy_high_idr)}</strong></div><div><small>MAX BUY / MAKSIMAL BELI</small><strong>{target.max_buy_price_idr ? moneyIdr(target.max_buy_price_idr) : 'Tidak cukup data'}</strong></div><div><small>RESALE / JUAL KEMBALI</small><strong>{moneyRange(target.resale_low, target.resale_high, target.resale_currency || 'UNKNOWN')}</strong></div></div>
    {target.market_evidence_summary && <p className="hunter-evidence">Market evidence / bukti pasar: {target.market_evidence_summary}</p>}
    <div className="hunter-target-meta"><span><b>Marketplace fit:</b> {Object.entries(target.marketplace_fit || {}).map(([market, fit]) => `${market}: ${fit.fit}`).join(' · ') || 'Belum diketahui'}</span><span><b>International fit:</b> {target.international_fit || 'unknown'}</span><span><b>Risiko keaslian:</b> {target.authenticity_risk || 'Authenticity not verified; manual review required.'}</span></div>
    <details className="hunter-inspection"><summary>Checklist inspeksi / Inspection checklist</summary><ul>{(target.inspection_checklist || []).map((item, index) => <li key={index}>{item}</li>)}</ul></details>
    {sourceUrls.length > 0 && <SourceLinks urls={sourceUrls} citations={citations} />}
    <div className="hunter-target-actions">{isHere ? <><button type="button" disabled={Boolean(saved) || notSeen} className="hunter-found-button" onClick={onFound}>{saved ? '✓ Disimpan · CHECK' : 'Ditemukan / Found'}</button><button type="button" className={`hunter-not-seen ${notSeen ? 'active' : ''}`} onClick={onNotSeen}>{notSeen ? 'Tidak ada ✓' : 'Tidak ada / Not seen'}</button></> : <button type="button" disabled={Boolean(saved)} className="hunter-save-button" onClick={onSave}>{saved ? '✓ Tersimpan ke Sourcing' : 'Simpan ke Sourcing'}</button>}<button type="button" className="hunter-check-button" onClick={onCheck}>Cek Barang Ini / Check This Item</button></div>
    {section === 'caution' && <small className="hunter-risk-note">Risiko tinggi: minta foto/tag tambahan, jangan putuskan keaslian dari tampilan saja.</small>}
  </article>
}

function SourceLinks({ urls = [], citations = [] }) {
  if (!urls.length) return <small className="hunter-no-sources">Belum ada sumber langsung yang cukup untuk klaim harga spesifik.</small>
  return <ul className="hunter-source-links">{urls.map((url) => { const source = sourceFor(url, citations); return <li key={url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li> })}</ul>
}

function HunterItemCheckSheet({ target, destination, sessionId, briefId, files, setFiles, askingPrice, setAskingPrice, result, setResult, busy, setBusy, error, setError, onClose, onSaveCandidate }) {
  const [previews, setPreviews] = useState([])
  useEffect(() => { const urls = files.map((file) => URL.createObjectURL(file)); setPreviews(urls); return () => urls.forEach((url) => URL.revokeObjectURL(url)) }, [files])
  async function analyze(event) {
    event.preventDefault(); setError(''); setResult(null)
    if (!AI_ENABLED) { setError('AI belum diaktifkan di environment ini.'); return }
    if (!files.length || files.length > 3) { setError('Pilih 1–3 foto barang.'); return }
    if (!askingPrice || Number(askingPrice) <= 0) { setError('Masukkan harga yang diminta penjual.'); return }
    setBusy(true)
    try {
      const imageDataUrls = []
      for (const inputFile of files) {
        const normalized = await prepareProductPhoto(inputFile)
        const optimized = await resizeHunterPhoto(normalized)
        imageDataUrls.push(await photoDataUrl(optimized))
      }
      const data = await callHunterFunction({ feature: 'HUNTER_ITEM_CHECK', session_id: sessionId, message: 'Secondary in-location photo check', destination, asking_price_idr: Number(askingPrice), target: target ? { target_id: target.target_id, item_name: target.item_name, category: target.category, ideal_buy_high_idr: target.ideal_buy_high_idr, max_buy_price_idr: target.max_buy_price_idr, resale_low: target.resale_low, resale_high: target.resale_high, resale_currency: target.resale_currency, source_urls: target.source_urls } : null, brief_id: briefId, image_data_urls: imageDataUrls })
      if (!data.result) throw new Error('Photo check did not return a valid assessment.')
      setResult(data.result)
    } catch (caught) { setError(errorMessage(caught, 'Foto belum bisa dianalisis.')) }
    finally { setBusy(false) }
  }
  return <div className="hunter-check-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="hunter-check-sheet" role="dialog" aria-modal="true" aria-labelledby="hunter-check-title"><header><div><small>SECONDARY ACTION / CEK BARANG</small><h2 id="hunter-check-title">Check this item</h2><p>{target?.item_name || 'Cek foto barang yang ditemukan'}</p></div><button type="button" aria-label="Tutup" onClick={onClose}>×</button></header><form onSubmit={analyze}><label className="hunter-upload-label">Foto barang / Product photos<input type="file" accept="image/*" multiple onChange={(event) => { setFiles([...event.target.files].slice(0, 3)); setError('') }} /></label><span className="hunter-upload-hint">1–3 foto · diperkecil di perangkat · tidak disimpan sebagai stok</span>{previews.length > 0 && <div className="hunter-preview-grid">{previews.map((url, index) => <img key={url} src={url} alt={`Product photo ${index + 1}`} />)}</div>}<label>Harga penjual / Asking price (IDR)<input type="number" min="1" inputMode="numeric" value={askingPrice} onChange={(event) => setAskingPrice(event.target.value)} placeholder="150000" /></label>{error && <div className="hunter-error" role="alert">{error}</div>}<div className="hunter-check-actions"><button className="hunter-check-primary" disabled={busy || !AI_ENABLED}>{busy ? 'Menganalisis foto…' : 'Analisis foto'}</button><button type="button" className="hunter-check-secondary" onClick={onClose}>Batal</button></div></form>{result && <section className="hunter-check-result"><div className={`hunter-verdict ${String(result.verdict).toLowerCase()}`}>{result.verdict}</div><p><b>Target match:</b> {result.target_match}</p><p><b>Kondisi:</b> {result.condition_summary}</p><p><b>Minus terlihat:</b> {(result.visible_defects || []).join(' · ') || 'Tidak terlihat jelas'}</p><p><b>Authenticity risk:</b> {result.authenticity_risk}</p><p className="hunter-auth-warning">{result.authenticity_note}</p><p><b>Market fit:</b> {result.market_fit}</p>{result.possible_gross_margin_idr != null && <p><b>Possible gross margin:</b> {moneyIdr(result.possible_gross_margin_idr)} <small>(screening estimate only)</small></p>}<ul>{(result.inspection_checklist || []).map((item, index) => <li key={index}>{item}</li>)}</ul><button type="button" className="hunter-check-primary" onClick={() => void onSaveCandidate(result)}>Save candidate to Sourcing</button></section>}</section></div>
}

export function HunterAnalyticsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  useEffect(() => { async function load() { if (!supabase) { setError('Supabase belum dikonfigurasi.'); setBusy(false); return }; const { data: result, error: rpcError } = await supabase.rpc('hunter_admin_analytics'); if (rpcError) setError(errorMessage(rpcError, 'Analytics belum bisa dimuat.')); else setData(result); setBusy(false) }; void load() }, [])
  const kpis = [
    ['Destination briefs', data?.brief_count || 0],
    ['Research refreshes', data?.refresh_count || 0],
    ['Item checks', data?.item_check_count || 0],
    ['Hunter AI cost', moneyIdr(data?.hunter_cost_idr || 0)],
  ]
  return <section className="hunter-analytics"><header><small>ADMIN ONLY · THIS MONTH</small><h1>Hunter Analytics</h1><p>Aggregated sourcing engagement. No buyer or seller PII is shown.</p></header>{error && <div className="hunter-error" role="alert">{error}</div>}{busy ? <p>Loading Hunter analytics…</p> : <><div className="hunter-analytics-kpis">{kpis.map(([label, value]) => <article key={label}><small>{label}</small><strong>{value}</strong></article>)}</div><div className="hunter-analytics-grid"><AnalyticsList title="Most requested destinations" items={data?.most_requested_destinations} /><AnalyticsList title="Most recommended categories" items={data?.most_recommended_categories} /><AnalyticsList title="Conversion" items={[{ label: 'Checked → Bought', value: `${data?.checked_to_bought?.bought || 0} / ${data?.checked_to_bought?.checked || 0}` }, { label: 'Bought → Sold', value: `${data?.bought_to_sold?.sold || 0} / ${data?.bought_to_sold?.bought || 0}` }]} /></div></>}</section>
}

function AnalyticsList({ title, items = [] }) {
  return <section className="hunter-analytics-card"><h2>{title}</h2>{items?.length ? items.map((item) => <div key={item.label}><span>{item.label}</span><b>{item.value ?? item.count ?? 0}</b></div>) : <p>Belum cukup data untuk insight yang valid.</p>}</section>
}

