import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AI_ENABLED, supabase } from './supabase-client'
import { prepareProductPhoto } from './seller-photos'
import { filterHunterTargets, HUNTER_DESTINATIONS, sortHunterTargets } from './hunter-utils'
import { routeHunterInteraction } from './hunter-router'
import { advanceHunterActivity, beginHunterActivity, finishHunterActivity, hunterActivityLabel, isHunterActivityActive } from './hunter-loading'
import { moneyIdr } from './seller-utils'
import './hunter.css'

const OPENING = 'Hari ini mau hunting ke mana?'

function errorMessage(error, fallback = 'Belum berhasil. Coba lagi sebentar.') {
  const raw = String(error?.message || error || '')
  const signal = `${String(error?.code || '')} ${raw}`
  if (/AI_MONTHLY_BUDGET_REACHED|budget/i.test(signal)) return 'Budget AI bulanan sudah tercapai. Inventory dan sourcing manual tetap bisa dipakai.'
  if (/AI_NOT_CONFIGURED/i.test(signal)) return 'AI belum dikonfigurasi di server. Sourcing manual tetap tersedia.'
  if (/AI_TIMEOUT|timed out|timeout/i.test(signal)) return 'Permintaan AI terlalu lama. Brief tersimpan tetap bisa dipakai; coba lagi sebentar.'
  if (/AI_RATE_LIMITED|rate limit/i.test(signal)) return 'AI sedang menerima terlalu banyak permintaan. Coba lagi sebentar.'
  if (/AI_OUTPUT_LIMIT/i.test(signal)) return 'Riset terlalu panjang dan belum selesai. Coba refresh lagi; brief tersimpan dan inventory tetap aman.'
  if (/AI_CONTENT_FILTERED/i.test(signal)) return 'Riset tertahan oleh pemeriksaan keamanan AI. Coba tujuan atau permintaan yang lebih spesifik.'
  if (/AI_REFUSED/i.test(signal)) return 'AI tidak dapat menyelesaikan permintaan riset ini. Coba permintaan yang lebih spesifik.'
  if (/AI_INVALID_RESPONSE/i.test(signal)) return 'Jawaban AI belum terbaca dengan benar. Coba ulangi tanpa mengubah data inventory.'
  if (/IMAGE_UNAVAILABLE/i.test(signal)) return 'Foto tidak bisa dianalisis. Pilih JPEG, PNG, atau WebP lain.'
  return raw || fallback
}

function HunterSpinner() {
  return <span className="hunter-loading-spinner" aria-hidden="true" />
}

function HunterActivityStatus({ label, detail, compact = false }) {
  return <div className={`hunter-action-status${compact ? ' compact' : ''}`} role="status" aria-live="polite" aria-atomic="true" aria-busy="true">
    <HunterSpinner />
    <span><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
  </div>
}

async function callHunterFunction(body) {
  const { data, error } = await supabase.functions.invoke('seller-ai', { body })
  if (error) {
    let message = error.message
    let errorCode = ''
    try {
      const response = error.context
      const payload = await (typeof response?.clone === 'function' ? response.clone() : response).json()
      message = payload?.message || payload?.error || message
      errorCode = payload?.error || ''
    } catch { /* Keep the SDK error if there is no readable response body. */ }
    throw Object.assign(new Error(message || 'Hunter request failed.'), { code: errorCode })
  }
  if (!data?.ok) throw Object.assign(new Error(data?.message || data?.error || 'AI Hunter request failed.'), { code: data?.error })
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
  const [marketGoal, setMarketGoal] = useState('both')
  const [preflightStep, setPreflightStep] = useState('destination')
  const [activeSection, setActiveSection] = useState('all')
  const [sortMode, setSortMode] = useState('best')
  const [pendingRefresh, setPendingRefresh] = useState(false)
  const [isHere, setIsHere] = useState(false)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [activity, setActivity] = useState(() => finishHunterActivity())
  const [actionError, setActionError] = useState(null)
  const [actionNotice, setActionNotice] = useState(null)
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
  const requestInFlight = useRef(false)
  const actionNoticeTimer = useRef(null)

  useEffect(() => { void initialize() }, [])
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages.length, loading])
  useEffect(() => {
    if (!activity.action) return undefined
    const timer = window.setInterval(() => setActivity((current) => advanceHunterActivity(current)), 3600)
    return () => window.clearInterval(timer)
  }, [activity.action])
  useEffect(() => () => window.clearTimeout(actionNoticeTimer.current), [])

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
    setSessionId(session.id); setDestination(session.destination || ''); setCategoryFocus(session.category_focus || []); setBudgetIdr(session.budget_idr || null); setMarketGoal('both'); setActiveSection('all'); setFocusedTargetIds([]); setSortMode('best'); setPreflightStep(session.destination ? 'budget' : 'destination'); setPendingRefresh(false); setIsHere(Boolean(session.is_here)); setError('')
    const { data, error: messagesError } = await supabase.from('hunter_messages').select('id,role,content,message_kind,metadata,created_at').eq('session_id', session.id).order('created_at', { ascending: true }).limit(100)
    if (messagesError) { setError(errorMessage(messagesError)); setMessages([]); return }
    setMessages(data || [])
    const latestBriefMessage = [...(data || [])].reverse().find((item) => item.message_kind === 'brief' && item.metadata?.brief_id)
    if (latestBriefMessage) {
      const { data: briefRecord } = await supabase.from('hunter_briefs').select('id,destination,brief_json,citations,created_at,expires_at').eq('id', latestBriefMessage.metadata.brief_id).maybeSingle()
      setBrief(briefRecord ? { id: briefRecord.id, destination: briefRecord.destination, brief: briefRecord.brief_json, citations: briefRecord.citations || [], created_at: briefRecord.created_at, expires_at: briefRecord.expires_at } : null)
      if (briefRecord && String(briefRecord.destination || '').toLocaleLowerCase('id-ID') === String(session.destination || '').toLocaleLowerCase('id-ID')) setPreflightStep('done')
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
    setSessions((current) => [data, ...current].slice(0, 20)); setBrief(null); setMessages([]); setDestination(''); setCategoryFocus([]); setBudgetIdr(null); setMarketGoal('both'); setActiveSection('all'); setSortMode('best'); setPreflightStep('destination'); setPendingRefresh(false); setIsHere(false); setNotSeen({}); await selectSession(data)
  }

  async function updateSession(values) {
    if (!sessionId || !supabase) return
    const next = { ...values, updated_at: new Date().toISOString() }
    const { error: updateError } = await supabase.from('hunter_sessions').update(next).eq('id', sessionId)
    if (updateError) setError(errorMessage(updateError, 'Perubahan konteks belum tersimpan.'))
    else setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, ...next } : session))
  }

  function routerState() { return { destination, budgetIdr, categoryFocus, marketGoal, preflightStep, activeSection } }

  async function applyRouterState(next) {
    if (!next) return
    setDestination(next.destination || '')
    setBudgetIdr(next.budgetIdr ?? null)
    setCategoryFocus(next.categoryFocus || [])
    setMarketGoal(next.marketGoal || 'both')
    setPreflightStep(next.preflightStep || 'summary')
    setActiveSection(next.activeSection || 'all')
    const changes = {}
    if (next.destination !== destination) changes.destination = next.destination || null
    if (next.budgetIdr !== undefined) changes.budget_idr = next.budgetIdr
    if (next.categoryFocus) changes.category_focus = next.categoryFocus
    if (Object.keys(changes).length) await updateSession(changes)
  }

  function appendLocalExchange(sellerText, reply) {
    const at = new Date().toISOString()
    setMessages((current) => [...current,
      ...(sellerText ? [{ id: `local-user-${Date.now()}`, role: 'user', content: sellerText, message_kind: 'local', created_at: at }] : []),
      { id: `local-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'assistant', content: reply, message_kind: 'local', created_at: at },
    ])
  }

  function showActionNotice(action, message) {
    window.clearTimeout(actionNoticeTimer.current)
    setActionNotice({ action, message })
    actionNoticeTimer.current = window.setTimeout(() => setActionNotice(null), 4200)
  }

  async function executeHunterDecision(decision, { message = '', itemBody = null } = {}) {
    if (!['LOAD_CACHE', 'START_RESEARCH', 'REFRESH_RESEARCH', 'AI_CHAT', 'ITEM_CHECK'].includes(decision?.type)) return null
    if (requestInFlight.current) return null
    if (!AI_ENABLED) { setError('AI belum diaktifkan di environment ini. Rencana dan inventory manual tetap bisa digunakan.'); return null }
    if (!supabase || !sessionId) { setError('Sesi belum siap. Muat ulang Seller Panel lalu coba lagi.'); return null }
    const feature = decision.type === 'LOAD_CACHE' || decision.type === 'START_RESEARCH' ? 'HUNTER_DESTINATION_BRIEF'
      : decision.type === 'REFRESH_RESEARCH' ? 'HUNTER_REFRESH'
        : decision.type === 'AI_CHAT' ? 'HUNTER_CHAT' : 'HUNTER_ITEM_CHECK'
    const requestBody = itemBody || {
      feature,
      session_id: sessionId,
      message,
      destination,
      category_focus: categoryFocus,
      budget_idr: budgetIdr,
      market_goal: marketGoal,
      active_section: activeSection,
      selected_target_ids: focusedTargetIds.slice(0, 3),
      ...(['LOAD_CACHE', 'START_RESEARCH', 'REFRESH_RESEARCH'].includes(decision.type) ? { research_confirmed: true } : {}),
    }
    const optimisticId = `pending-${Date.now()}`
    if (message && feature !== 'HUNTER_ITEM_CHECK') setMessages((current) => [...current, { id: optimisticId, role: 'user', content: message, message_kind: 'chat', created_at: new Date().toISOString() }])
    setError('')
    setActionError(null)
    setActionNotice(null)
    window.clearTimeout(actionNoticeTimer.current)
    requestInFlight.current = true
    setLoading(true)
    setActivity((current) => beginHunterActivity(current, decision.type))
    try {
      const data = await callHunterFunction(requestBody)
      if (data.session_id && data.session_id !== sessionId) setSessionId(data.session_id)
      if (data.destination) setDestination(data.destination)
      if (data.brief) { setBrief(data.brief); setPreflightStep('done'); setPendingRefresh(false) }
      if (Array.isArray(data.category_focus)) setCategoryFocus(data.category_focus)
      if (data.budget_idr != null) setBudgetIdr(data.budget_idr)
      if (Array.isArray(data.focused_target_ids)) setFocusedTargetIds(data.focused_target_ids)
      if (feature !== 'HUNTER_ITEM_CHECK') setMessages((current) => [...current, { id: `local-assistant-${Date.now()}`, role: 'assistant', content: data.assistant_message || data.reply || 'Selesai.', message_kind: data.brief ? 'brief' : 'chat', metadata: data.brief_id ? { brief_id: data.brief_id } : {}, created_at: new Date().toISOString() }])
      if (data.session_id) setSessions((current) => current.map((session) => session.id === data.session_id ? { ...session, updated_at: new Date().toISOString(), destination: data.destination || session.destination } : session))
      if (data.brief && decision.type === 'REFRESH_RESEARCH') showActionNotice('REFRESH_RESEARCH', 'Riset diperbarui')
      else if (data.brief && ['LOAD_CACHE', 'START_RESEARCH'].includes(decision.type)) showActionNotice(decision.type, data.cached ? 'Brief dari cache dimuat' : 'Hunting Brief siap')
      return data
    } catch (caught) {
      if (message && feature !== 'HUNTER_ITEM_CHECK') setMessages((current) => current.filter((item) => item.id !== optimisticId))
      const friendlyError = errorMessage(caught, 'AI Hunter sedang tidak tersedia.')
      if (feature === 'HUNTER_ITEM_CHECK') setError('')
      else {
        setActionError({ action: decision.type, message: friendlyError })
        setError(friendlyError)
      }
      throw caught
    } finally {
      requestInFlight.current = false; setLoading(false); setActivity((current) => finishHunterActivity(current)); void refreshAiBudget()
    }
  }

  async function handleText(text) {
    const trimmed = String(text || '').trim().slice(0, 1000)
    if (!trimmed || loading) return
    const hasCurrentBrief = Boolean(brief && String(brief.destination || brief.brief?.destination_name || '').toLocaleLowerCase('id-ID') === String(destination).toLocaleLowerCase('id-ID'))
    const decision = routeHunterInteraction({ text: trimmed, state: routerState(), hasBrief: hasCurrentBrief })
    if (decision.type === 'PREFLIGHT_RESPONSE' || decision.type === 'PREFLIGHT_CLARIFY' || decision.type === 'LOCAL_FILTER' || decision.type === 'LOCAL_SORT') {
      setError('')
      setActionError(null)
      await applyRouterState(decision.state)
      if (decision.type === 'LOCAL_SORT') {
        const filtered = filterHunterTargets(brief?.brief, { categories: categoryFocus, budgetIdr, marketGoal, activeSection })
        const sorted = sortHunterTargets(filtered, decision.sort)
        setSortMode(decision.sort)
        setFocusedTargetIds(decision.limit ? sorted.slice(0, decision.limit).map((target) => target.target_id) : [])
      } else if (decision.type === 'LOCAL_FILTER') { setFocusedTargetIds([]); setSortMode('best') }
      appendLocalExchange(trimmed, decision.reply)
      return
    }
    await executeHunterDecision(decision, { message: trimmed })
  }

  async function choosePreflight(action, value, label) {
    const decision = routeHunterInteraction({ action, value, state: routerState() })
    setError('')
    setActionError(null)
    await applyRouterState(decision.state)
    if (decision.type === 'LOCAL_FILTER') { setFocusedTargetIds([]); setSortMode('best') }
    appendLocalExchange(label, decision.reply)
  }

  async function confirmResearch() {
    const decision = routeHunterInteraction({ action: 'confirm_research', state: routerState() })
    if (decision.type === 'PREFLIGHT_CLARIFY') { setError(decision.reply); return }
    await executeHunterDecision(decision, { message: `Rencana hunting: ${destination}` })
  }

  async function confirmRefresh() {
    const decision = routeHunterInteraction({ action: 'refresh_research', state: routerState() })
    await executeHunterDecision(decision, { message: `Perbarui research untuk ${destination || brief?.destination}` })
  }

  async function analyzeItemThroughRouter(requestBody) {
    const decision = routeHunterInteraction({ action: 'item_check', state: routerState() })
    return executeHunterDecision(decision, { itemBody: requestBody })
  }

  const hasCurrentBrief = Boolean(brief && String(brief.destination || brief.brief?.destination_name || '').toLocaleLowerCase('id-ID') === String(destination).toLocaleLowerCase('id-ID'))
  const loadingLabel = hunterActivityLabel(activity)
  const visibleTargets = useMemo(() => {
    const filtered = filterHunterTargets(brief?.brief, { categories: categoryFocus, budgetIdr, marketGoal, activeSection })
    return sortHunterTargets(filtered, sortMode).filter((target) => !focusedTargetIds.length || focusedTargetIds.includes(target.target_id))
  }, [brief, categoryFocus, budgetIdr, marketGoal, activeSection, sortMode, focusedTargetIds])

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

  function submitInput(event) { event.preventDefault(); const text = question; setQuestion(''); void handleText(text) }

  const age = brief?.created_at ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(brief.created_at)) : ''

  return <div className="hunter-page">
    <header className="hunter-page-head"><div><span className="hunter-eyebrow">HAQLOOKS SOURCING COPILOT</span><h1>AI Hunter</h1><p>Asisten sourcing Haqlooks · Haqlooks sourcing assistant</p></div><div className="hunter-session-actions"><label className="sr-only" htmlFor="hunter-session">Pilih sesi Hunter</label><select id="hunter-session" value={sessionId} onChange={(event) => { const selected = sessions.find((item) => item.id === event.target.value); if (selected) void selectSession(selected) }}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.destination || 'Percakapan baru'}</option>)}</select><button className="hunter-icon-button" type="button" onClick={() => void newSession()} aria-label="Mulai percakapan baru">＋</button></div></header>
    {!AI_ENABLED && <div className="hunter-disabled" role="status"><strong>AI belum diaktifkan di environment ini.</strong><span>Inventory dan candidate manual tetap tersedia. Backend Hunter akan aktif setelah flag AI pada deployment diizinkan.</span></div>}
    {Number(aiBudget?.percentage || 0) >= 90 && <div className="hunter-budget-warning" role="status"><strong>{Number(aiBudget?.percentage || 0) >= 100 ? 'AI monthly budget reached' : 'Budget AI hampir tercapai'}</strong><span>{moneyIdr(aiBudget?.used || 0)} dari {moneyIdr(aiBudget?.budget || 100000)} terpakai. Sourcing manual tetap tersedia.</span></div>}
    {error && !actionError && <div className="hunter-error" role="alert">{error}</div>}
    <section className="hunter-chat" aria-label="Percakapan AI Hunter" aria-busy={loading}>
      <div className="hunter-bubble assistant"><small>HAQLOOKS HUNTER</small><p>{OPENING}</p><p className="hunter-translation">Where are you sourcing today?</p></div>
      {messages.map((message) => <article className={`hunter-bubble ${message.role === 'assistant' ? 'assistant' : 'seller'}`} key={message.id}><small>{message.role === 'assistant' ? 'HAQLOOKS HUNTER' : 'KAMU / YOU'}</small><p>{message.content}</p></article>)}
      {loading && <div className="hunter-bubble assistant hunter-thinking" role="status" aria-live="polite"><HunterSpinner />{loadingLabel}</div>}
      <div ref={chatEnd} />
    </section>
    {preflightStep !== 'done' && <section className="hunter-preflight" aria-label="Rencana hunting">
      <header><div><small>PREFLIGHT GRATIS · TANPA AI</small><h2>Rencana Hunting</h2></div>{destination && <span>{destination}</span>}</header>
      {preflightStep === 'destination' && <><p>Hari ini mau hunting ke mana?</p><div className="hunter-preflight-options">{HUNTER_DESTINATIONS.map((place) => <button type="button" key={place.value} disabled={loading} onClick={() => void choosePreflight('destination', place.value, place.label)}>{place.label}</button>)}<button type="button" disabled={loading} onClick={() => { setQuestion(''); void choosePreflight('other_destination', undefined, '＋ Tempat lain') }}>＋ Tempat lain</button></div></>}
      {preflightStep === 'budget' && <><p>Budget hunting hari ini berapa?</p><div className="hunter-preflight-options">{[['< Rp300k', 200000], ['Rp300–500k', 400000], ['Rp500k–1jt', 750000], ['> Rp1jt', 1500000], ['Bebas', null]].map(([label, value]) => <button type="button" key={label} disabled={loading} onClick={() => void choosePreflight('budget', value, label)}>{label}</button>)}</div></>}
      {preflightStep === 'category' && <><p>Mau fokus cari apa?</p><div className="hunter-preflight-options">{[['Semua', []], ['Kaos', ['T-shirts']], ['Jaket', ['Jackets']], ['Sepatu', ['Shoes']], ['Tas / Aksesoris', ['Bags', 'Accessories']]].map(([label, value]) => <button type="button" key={label} disabled={loading} onClick={() => void choosePreflight('category', value, label)}>{label}</button>)}</div></>}
      {preflightStep === 'market' && <><p>Target jualnya ke mana?</p><div className="hunter-preflight-options">{[['Lokal', 'local'], ['Internasional', 'international'], ['Keduanya', 'both']].map(([label, value]) => <button type="button" key={value} disabled={loading} onClick={() => void choosePreflight('market', value, label)}>{label}</button>)}</div></>}
      {preflightStep === 'summary' && <><dl><div><dt>Lokasi</dt><dd>{destination || 'Belum dipilih'}</dd></div><div><dt>Budget</dt><dd>{budgetIdr ? moneyIdr(budgetIdr) : 'Bebas'}</dd></div><div><dt>Fokus</dt><dd>{categoryFocus.length ? categoryFocus.join(', ') : 'Semua kategori'}</dd></div><div><dt>Target pasar</dt><dd>{marketGoal === 'international' ? 'Internasional' : marketGoal === 'local' ? 'Lokal' : 'Keduanya'}</dd></div></dl><p className="hunter-preflight-cost">Research AI akan mencari data pasar terbaru. Stok fisik tidak dijamin; hasil adalah hipotesis sourcing. Research fresh akan dipakai dari cache 12 jam tanpa biaya baru.</p><div className="hunter-preflight-actions" aria-busy={isHunterActivityActive(activity, 'START_RESEARCH') || isHunterActivityActive(activity, 'LOAD_CACHE')}><button type="button" className="hunter-preflight-edit" disabled={loading} onClick={() => { const decision = routeHunterInteraction({ action: 'edit', state: routerState() }); void applyRouterState(decision.state); appendLocalExchange('Ubah rencana', decision.reply) }}>Ubah</button><button type="button" className="hunter-preflight-start" disabled={!AI_ENABLED || loading || !destination} aria-busy={isHunterActivityActive(activity, 'START_RESEARCH') || isHunterActivityActive(activity, 'LOAD_CACHE')} onClick={() => void confirmResearch()}>{isHunterActivityActive(activity, 'START_RESEARCH') || isHunterActivityActive(activity, 'LOAD_CACHE') ? <><HunterSpinner /> Memeriksa…</> : 'Mulai Research'}</button></div>{(isHunterActivityActive(activity, 'START_RESEARCH') || isHunterActivityActive(activity, 'LOAD_CACHE')) && <HunterActivityStatus label={loadingLabel} detail="Status aktivitas—bukan persentase atau estimasi penyelesaian." />}{actionError?.action === 'START_RESEARCH' && <div className="hunter-action-feedback error" role="alert">{actionError.message}</div>}{actionNotice && ['LOAD_CACHE', 'START_RESEARCH'].includes(actionNotice.action) && <div className="hunter-action-feedback success" role="status">{actionNotice.message}</div>}{!AI_ENABLED && <small>AI belum diaktifkan untuk environment ini.</small>}</>}
    </section>}
    {hasCurrentBrief && <HunterBriefView briefRecord={brief} age={age} isHere={isHere} loading={loading} activity={activity} activityLabel={loadingLabel} actionError={actionError} actionNotice={actionNotice} visibleTargets={visibleTargets} categories={categoryFocus} budgetIdr={budgetIdr} marketGoal={marketGoal} activeSection={activeSection} refreshPending={pendingRefresh} onRefresh={() => { setError(''); setActionError(null); setPendingRefresh(true) }} onConfirmRefresh={() => void confirmRefresh()} onCancelRefresh={() => setPendingRefresh(false)} onToggleHere={() => void toggleHere()} onSaveTarget={saveTarget} sourceCandidates={sourceCandidates} notSeen={notSeen} onNotSeen={markNotSeen} onCheck={(target) => { const decision = routeHunterInteraction({ action: 'item_check', state: routerState() }); if (decision.type === 'ITEM_CHECK' && !loading) { setActionError(null); setActionNotice(null); setCheckTarget(target); setCheckFiles([]); setCheckPrice(''); setItemCheck(null); setCheckError('') } }} />}
    <form className={`hunter-composer${isHunterActivityActive(activity, 'AI_CHAT') ? ' is-busy' : ''}`} onSubmit={submitInput} aria-busy={loading}><label className="sr-only" htmlFor="hunter-question">Tulis pesan ke AI Hunter</label>{isHunterActivityActive(activity, 'AI_CHAT') && <HunterActivityStatus label={loadingLabel} detail="Jawaban disusun dari brief tersimpan." compact />}<textarea id="hunter-question" rows="2" maxLength="1000" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitInput(event) } }} placeholder={preflightStep === 'destination' ? 'Tulis lokasi hunting…' : preflightStep === 'budget' ? 'Atau tulis budget, contoh 500 ribu…' : preflightStep === 'category' ? 'Atau tulis kategori, contoh jaket…' : preflightStep === 'market' ? 'Pilih lokal, internasional, atau keduanya…' : 'Tanya alasan atau perbandingan dari brief tersimpan…'} disabled={loading} /><button className="hunter-send" type="submit" disabled={loading || !question.trim()} aria-busy={isHunterActivityActive(activity, 'AI_CHAT')} aria-label={isHunterActivityActive(activity, 'AI_CHAT') ? 'Menyiapkan jawaban' : 'Kirim pesan'}>{isHunterActivityActive(activity, 'AI_CHAT') ? <><HunterSpinner /> Membalas…</> : 'Kirim ↑'}</button>{actionError?.action === 'AI_CHAT' && <div className="hunter-action-feedback error" role="alert">{actionError.message}</div>}</form>
    {hasCurrentBrief && <div className="hunter-suggested-filters" aria-busy={loading}>{[["Kaos + jaket", () => void choosePreflight('filter', { field: 'category', value: ['T-shirts', 'Jackets'] }, 'Kaos + jaket')], ["Modal Rp300k", () => void choosePreflight('filter', { field: 'budget', value: 300000 }, 'Budget Rp300k')], [marketGoal === 'international' ? 'Tampilkan semua' : 'Internasional saja', () => void choosePreflight('filter', { field: 'market', value: marketGoal === 'international' ? 'both' : 'international' }, marketGoal === 'international' ? 'Tampilkan semua' : 'Internasional saja')], ['Wildcard', () => void choosePreflight('filter', { field: 'section', value: 'wildcard' }, 'Tampilkan wildcard')], ['Prioritas', () => void choosePreflight('filter', { field: 'section', value: 'priority' }, 'Prioritas utama')], ['Paling murah', () => void handleText('paling murah')], ['Semua kategori', () => void choosePreflight('filter', { field: 'category', value: [] }, 'Semua kategori')], ['Reset filter', () => void handleText('reset filter')], ['Rencana baru', () => { const decision = routeHunterInteraction({ action: 'restart', state: routerState() }); void applyRouterState(decision.state); setPreflightStep('destination'); appendLocalExchange('Rencana baru', decision.reply) }]].map(([label, action]) => <button type="button" key={label} disabled={loading} onClick={action}>{label}</button>)}</div>}
    {checkTarget && <HunterItemCheckSheet target={checkTarget} files={checkFiles} setFiles={setCheckFiles} askingPrice={checkPrice} setAskingPrice={setCheckPrice} result={itemCheck} setResult={setItemCheck} busy={checkBusy || isHunterActivityActive(activity, 'ITEM_CHECK')} activityLabel={loadingLabel} error={checkError} setError={setCheckError} onClose={() => { if (!checkBusy && !loading) setCheckTarget(null) }} onAnalyze={async (imageDataUrls) => analyzeItemThroughRouter({ feature: 'HUNTER_ITEM_CHECK', session_id: sessionId, message: 'Secondary in-location photo check', destination, asking_price_idr: Number(checkPrice), target: checkTarget ? { target_id: checkTarget.target_id, item_name: checkTarget.item_name, category: checkTarget.category, ideal_buy_high_idr: checkTarget.ideal_buy_high_idr, max_buy_price_idr: checkTarget.max_buy_price_idr, resale_low: checkTarget.resale_low, resale_high: checkTarget.resale_high, resale_currency: checkTarget.resale_currency, source_urls: checkTarget.source_urls } : null, brief_id: brief?.id, image_data_urls: imageDataUrls })} onSaveCandidate={async (result) => { const created = await saveTarget({ ...checkTarget, authenticity_risk: result.authenticity_risk }, result.verdict === 'CHECK' ? 'CHECK' : 'WATCHING'); if (created) setCheckTarget(null) }} />}
  </div>
}

function HunterBriefView({ briefRecord, age, isHere, loading, activity, activityLabel, actionError, actionNotice, visibleTargets, categories, budgetIdr, marketGoal, activeSection, refreshPending, onRefresh, onConfirmRefresh, onCancelRefresh, onToggleHere, onSaveTarget, sourceCandidates, notSeen, onNotSeen, onCheck }) {
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
    {(categories.length > 0 || budgetIdr || marketGoal !== 'both' || activeSection !== 'all') && <div className="hunter-filter-note">Menampilkan {visibleCount} target dari riset yang sama{categories.length ? ` · ${categories.join(', ')}` : ''}{budgetIdr ? ` · budget ${moneyIdr(budgetIdr)}` : ''}{marketGoal !== 'both' ? ` · pasar ${marketGoal}` : ''}{activeSection !== 'all' ? ` · bagian ${activeSection.replaceAll('_', ' ')}` : ''}. Tidak melakukan web search baru.</div>}
    {isHere && <div className="hunter-on-location"><span>MODE DI LOKASI / I’M HERE</span><p>Checklist cepat saat membongkar barang. Pilih “Ditemukan” untuk menyimpan ke Sourcing dengan status CHECK.</p></div>}
    {sections.filter(([key]) => activeSection === 'all' || activeSection === key).map(([key, title, label]) => {
      const targets = (brief.sections?.[key] || []).filter((target) => visibleIds.has(target.target_id))
      if (!targets.length) return null
      return <section className="hunter-target-section" key={key}><h3>{title}<small>{label}</small></h3><div className="hunter-target-list">{targets.map((target, index) => <HunterTargetCard key={target.target_id || `${key}-${index}`} target={target} citations={citations} section={key} isHere={isHere} actionsDisabled={loading} saved={sourceCandidates[target.target_id]} notSeen={Boolean(notSeen[target.target_id])} onSave={() => onSaveTarget(target)} onFound={() => onSaveTarget(target, 'CHECK')} onNotSeen={() => onNotSeen(target)} onCheck={() => onCheck(target)} />)}</div></section>
    })}
    {!visibleCount && <div className="hunter-empty">Tidak ada target di brief yang cocok dengan filter ini. Coba longgarkan budget/kategori, atau minta fokus lain.</div>}
    {!!brief.new_discoveries?.length && <section className="hunter-discoveries"><h3>Barang yang mungkin belum kamu kenal<small>ITEMS WORTH LEARNING</small></h3><div className="hunter-discovery-list">{brief.new_discoveries.slice(0, 3).map((item, index) => <article key={`${item.name}-${index}`}><strong>{item.name}</strong><p>{item.what_it_is}</p><div><b>Ciri / quick ID:</b> {item.quick_identification}</div><div><b>Tag:</b> {(item.tags_to_check || []).join(', ') || '—'}</div><div><b>Fake risk:</b> {item.fake_risk}</div><div><b>Demand:</b> {item.demand_signal}</div><p>{item.why_learn}</p><SourceLinks urls={item.source_urls} citations={citations} /></article>)}</div></section>}
    {!!brief.internal_insights?.length && <section className="hunter-internal-insights"><h3>Insight Haqlooks / Internal signal</h3>{brief.internal_insights.map((insight, index) => <p key={index}>{insight}</p>)}</section>}
    <details className="hunter-sources"><summary>Sumber riset / Research sources ({citations.length})</summary><SourceLinks urls={citations.map((item) => item.url)} citations={citations} /></details>
    <footer className="hunter-brief-actions"><button className={`hunter-here-button ${isHere ? 'active' : ''}`} type="button" disabled={loading} onClick={onToggleHere}>{isHere ? '✓ Saya Sudah Sampai / I’m Here' : 'Saya Sudah Sampai / I’m Here'}</button><div className={`hunter-refresh-area${refreshPending ? ' pending' : ''}`} aria-busy={isHunterActivityActive(activity, 'REFRESH_RESEARCH')}>
      {actionNotice?.action === 'REFRESH_RESEARCH' && <div className="hunter-action-feedback success" role="status">{actionNotice.message}</div>}
      {refreshPending ? <div className="hunter-refresh-confirm">
        <span>Refresh dapat memakai AI dan mencari web baru.</span>
        {isHunterActivityActive(activity, 'REFRESH_RESEARCH') && <HunterActivityStatus label={activityLabel} detail="AI sedang mencari referensi terbaru dan menyusun ulang Hunting Brief. Bisa membutuhkan beberapa detik; status ini bukan estimasi progres." />}
        {actionError?.action === 'REFRESH_RESEARCH' && <div className="hunter-action-feedback error" role="alert">{actionError.message}</div>}
        <button type="button" className="hunter-refresh-button" disabled={loading} aria-busy={isHunterActivityActive(activity, 'REFRESH_RESEARCH')} onClick={onConfirmRefresh}>{isHunterActivityActive(activity, 'REFRESH_RESEARCH') ? <><HunterSpinner /> Sedang memperbarui riset…</> : 'Konfirmasi Refresh'}</button>
        <button type="button" className="hunter-preflight-edit" disabled={loading} onClick={onCancelRefresh}>Batal</button>
      </div> : <><button type="button" className="hunter-refresh-button" disabled={loading} onClick={onRefresh}>Perbarui Research</button>{actionError?.action === 'REFRESH_RESEARCH' && <div className="hunter-action-feedback error" role="alert">{actionError.message}</div>}</>}
    </div></footer>
  </section>
}

function HunterTargetCard({ target, citations, section, isHere, actionsDisabled, saved, notSeen, onSave, onFound, onNotSeen, onCheck }) {
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
    <div className="hunter-target-actions">{isHere ? <><button type="button" disabled={actionsDisabled || Boolean(saved) || notSeen} className="hunter-found-button" onClick={onFound}>{saved ? '✓ Disimpan · CHECK' : 'Ditemukan / Found'}</button><button type="button" disabled={actionsDisabled} className={`hunter-not-seen ${notSeen ? 'active' : ''}`} onClick={onNotSeen}>{notSeen ? 'Tidak ada ✓' : 'Tidak ada / Not seen'}</button></> : <button type="button" disabled={actionsDisabled || Boolean(saved)} className="hunter-save-button" onClick={onSave}>{saved ? '✓ Tersimpan ke Sourcing' : 'Simpan ke Sourcing'}</button>}<button type="button" disabled={actionsDisabled} className="hunter-check-button" onClick={onCheck}>Cek Barang Ini / Check This Item</button></div>
    {section === 'caution' && <small className="hunter-risk-note">Risiko tinggi: minta foto/tag tambahan, jangan putuskan keaslian dari tampilan saja.</small>}
  </article>
}

function SourceLinks({ urls = [], citations = [] }) {
  if (!urls.length) return <small className="hunter-no-sources">Belum ada sumber langsung yang cukup untuk klaim harga spesifik.</small>
  return <ul className="hunter-source-links">{urls.map((url) => { const source = sourceFor(url, citations); return <li key={url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li> })}</ul>
}

function HunterItemCheckSheet({ target, files, setFiles, askingPrice, setAskingPrice, result, setResult, busy, setBusy, activityLabel, error, setError, onClose, onAnalyze, onSaveCandidate }) {
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
      const data = await onAnalyze(imageDataUrls)
      if (!data.result) throw new Error('Photo check did not return a valid assessment.')
      setResult(data.result)
    } catch (caught) { setError(errorMessage(caught, 'Foto belum bisa dianalisis.')) }
    finally { setBusy(false) }
  }
  return <div className="hunter-check-overlay" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose() }}><section className="hunter-check-sheet" role="dialog" aria-modal="true" aria-labelledby="hunter-check-title" aria-busy={busy}><header><div><small>SECONDARY ACTION / CEK BARANG</small><h2 id="hunter-check-title">Check this item</h2><p>{target?.item_name || 'Cek foto barang yang ditemukan'}</p></div><button type="button" aria-label="Tutup" disabled={busy} onClick={onClose}>×</button></header><form onSubmit={analyze} aria-busy={busy}><label className="hunter-upload-label">Foto barang / Product photos<input type="file" accept="image/*" multiple disabled={busy} onChange={(event) => { setFiles([...event.target.files].slice(0, 3)); setError('') }} /></label><span className="hunter-upload-hint">1–3 foto · diperkecil di perangkat · tidak disimpan sebagai stok</span>{previews.length > 0 && <div className="hunter-preview-grid">{previews.map((url, index) => <img key={url} src={url} alt={`Product photo ${index + 1}`} />)}</div>}<label>Harga penjual / Asking price (IDR)<input type="number" min="1" inputMode="numeric" disabled={busy} value={askingPrice} onChange={(event) => setAskingPrice(event.target.value)} placeholder="150000" /></label>{error && <div className="hunter-error" role="alert">{error}</div>}<div className="hunter-check-actions"><button className="hunter-check-primary" disabled={busy || !AI_ENABLED} aria-busy={busy}>{busy ? <><HunterSpinner /> Menganalisis…</> : 'Analisis foto'}</button><button type="button" className="hunter-check-secondary" disabled={busy} onClick={onClose}>Batal</button></div>{busy && <HunterActivityStatus label={activityLabel || 'Menganalisis foto barang…'} detail="Foto sedang diperiksa. Ini bukan indikator persentase penyelesaian." />}</form>{result && <section className="hunter-check-result"><div className={`hunter-verdict ${String(result.verdict).toLowerCase()}`}>{result.verdict}</div><p><b>Target match:</b> {result.target_match}</p><p><b>Kondisi:</b> {result.condition_summary}</p><p><b>Minus terlihat:</b> {(result.visible_defects || []).join(' · ') || 'Tidak terlihat jelas'}</p><p><b>Authenticity risk:</b> {result.authenticity_risk}</p><p className="hunter-auth-warning">{result.authenticity_note}</p><p><b>Market fit:</b> {result.market_fit}</p>{result.possible_gross_margin_idr != null && <p><b>Possible gross margin:</b> {moneyIdr(result.possible_gross_margin_idr)} <small>(screening estimate only)</small></p>}<ul>{(result.inspection_checklist || []).map((item, index) => <li key={index}>{item}</li>)}</ul><button type="button" disabled={busy} className="hunter-check-primary" onClick={() => void onSaveCandidate(result)}>Save candidate to Sourcing</button></section>}</section></div>
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


