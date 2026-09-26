import { detectHunterCategories, detectHunterDestination, parseHunterBudget } from './hunter-utils.js'

export const HUNTER_DECISIONS = Object.freeze([
  'PREFLIGHT_RESPONSE',
  'PREFLIGHT_CLARIFY',
  'LOCAL_FILTER',
  'LOCAL_SORT',
  'LOAD_CACHE',
  'START_RESEARCH',
  'AI_CHAT',
  'ITEM_CHECK',
  'REFRESH_RESEARCH',
])

const CATEGORY_ALL = /^(semua|all|bebas kategori|apa saja)$/i
const MARKET_INTERNATIONAL = /\b(luar(?:\s+negeri)?|overseas|international|internasional)\b/i
const MARKET_LOCAL = /\b(lokal|indo(?:nesia)?|dalam negeri)\b/i
const MARKET_BOTH = /\b(keduanya|dua duanya|dua-duanya|semua market|both)\b/i
const COMPLEX_QUESTION = /\b(kenapa|mengapa|bandingkan|compare|worth(?: it)?|risiko|kondisi|lebih bagus|lebih cocok|pemula|alasan|masih layak)\b/i
const GREETING = /^(halo|hai|hi|hello|pagi|siang|sore|malam|gas|oke|ok|iya|ya|lanjut|sip|makasih|terima kasih)[.! ]*$/i
const CANCEL = /^(batal|cancel|nggak jadi|tidak jadi|stop)[.! ]*$/i

function stageAfter(state, field) {
  if (field === 'destination') return 'budget'
  if (field === 'budget') return 'category'
  if (field === 'category') return 'market'
  if (field === 'market') return state.destination ? 'summary' : 'destination'
  return state.destination ? 'budget' : 'destination'
}

function marketGoal(text) {
  if (MARKET_INTERNATIONAL.test(text)) return 'international'
  if (MARKET_LOCAL.test(text)) return 'local'
  if (MARKET_BOTH.test(text)) return 'both'
  return ''
}

function budgetFromIntent(text, preflightStep) {
  if (preflightStep === 'budget' || /\b(modal|budget|maksimal|max|per item|under|di bawah|rp)\b|\d+(?:[.,]\d+)?\s*(?:juta|jt|million|ribu|rb|k)\b/i.test(text)) return parseHunterBudget(text)
  return null
}

function sectionFromText(text) {
  if (/wildcard/i.test(text)) return 'wildcard'
  if (/prioritas utama|priority/i.test(text)) return 'priority'
  if (/aman dibeli|buy if cheap/i.test(text)) return 'buy_if_cheap'
  if (/hati[- ]hati|caution/i.test(text)) return 'caution'
  if (/jangan dikejar|skip|hindari/i.test(text)) return 'avoid'
  return ''
}

function fullDestination(text, state) {
  const detected = detectHunterDestination(text)
  if (detected) return detected
  if (state.preflightStep !== 'destination') return ''
  const value = String(text || '').trim().replace(/[.!?]+$/, '')
  if (value.length < 3 || value.length > 100 || /https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Z]{2,}/i.test(value)) return ''
  if (/\d{7,}/.test(value) || /\b(modal|budget|fokus|hunting|research|luar negeri|internasional|lokal)\b/i.test(value)) return ''
  return value
}

function response(type, fields = {}) {
  return { type, ...fields }
}

export function routeHunterInteraction({ action = 'message', text = '', value, state = {}, hasBrief = false, cacheFresh = null } = {}) {
  const current = {
    destination: String(state.destination || ''),
    budgetIdr: state.budgetIdr ?? null,
    categoryFocus: Array.isArray(state.categoryFocus) ? state.categoryFocus : [],
    marketGoal: state.marketGoal || 'both',
    preflightStep: state.preflightStep || (state.destination ? 'budget' : 'destination'),
    activeSection: state.activeSection || 'all',
  }

  if (action === 'item_check') return response('ITEM_CHECK')
  if (action === 'other_destination') return response('PREFLIGHT_RESPONSE', { reply: 'Tulis nama tempat atau marketplace yang ingin kamu kunjungi.', state: { ...current, preflightStep: 'destination' } })
  if (action === 'cancel') return response('PREFLIGHT_RESPONSE', { reply: 'Oke, dibatalkan. Tidak ada research atau biaya AI.', state: { ...current, preflightStep: current.destination ? 'summary' : 'destination' } })
  if (action === 'restart') return response('PREFLIGHT_RESPONSE', { reply: 'Kita susun rencana baru. Mau hunting ke mana?', state: { ...current, destination: '', budgetIdr: null, categoryFocus: [], marketGoal: 'both', preflightStep: 'destination', activeSection: 'all' } })
  if (action === 'destination') return response('PREFLIGHT_RESPONSE', { reply: `Oke, hunting di ${String(value || '').trim()}. Budget hunting hari ini berapa?`, state: { ...current, destination: String(value || '').trim(), preflightStep: 'budget' } })
  if (action === 'budget') return response('PREFLIGHT_RESPONSE', { reply: 'Mau fokus cari apa?', state: { ...current, budgetIdr: value == null ? null : Number(value), preflightStep: 'category' } })
  if (action === 'category') return response('PREFLIGHT_RESPONSE', { reply: 'Target jualnya ke mana?', state: { ...current, categoryFocus: Array.isArray(value) ? value : [], preflightStep: 'market' } })
  if (action === 'market') return response('PREFLIGHT_RESPONSE', { reply: 'Rencana sudah siap. Tinjau ringkasannya, lalu tekan Mulai Research bila ingin mencari data pasar terbaru.', state: { ...current, marketGoal: value || 'both', preflightStep: current.destination ? 'summary' : 'destination' } })
  if (action === 'edit') return response('PREFLIGHT_RESPONSE', { reply: 'Pilih lokasi yang ingin diubah; setelah itu kamu bisa meninjau ulang budget, fokus, dan target pasar.', state: { ...current, preflightStep: 'destination' } })
  if (action === 'confirm_research') return current.destination ? response(cacheFresh === true ? 'LOAD_CACHE' : 'START_RESEARCH', { state: current, researchConfirmed: true }) : response('PREFLIGHT_CLARIFY', { state: current, reply: 'Pilih lokasi hunting terlebih dahulu.' })
  if (action === 'refresh_research') return current.destination ? response('REFRESH_RESEARCH', { state: current, researchConfirmed: true }) : response('PREFLIGHT_CLARIFY', { state: current, reply: 'Pilih lokasi hunting terlebih dahulu.' })
  if (action === 'filter') {
    const field = value?.field
    const next = { ...current }
    if (field === 'budget') next.budgetIdr = value.value == null ? null : Number(value.value)
    else if (field === 'category') next.categoryFocus = Array.isArray(value.value) ? value.value : []
    else if (field === 'market') next.marketGoal = value.value || 'both'
    else if (field === 'section') next.activeSection = value.value || 'all'
    return response('LOCAL_FILTER', { state: next, reply: 'Filter diperbarui dari brief tersimpan—tanpa pencarian baru.' })
  }

  const raw = String(text || '').trim()
  if (!raw) return response('PREFLIGHT_CLARIFY', { reply: 'Ceritakan tujuan hunting atau pilih salah satu opsi di atas.', state: current })
  if (CANCEL.test(raw)) return routeHunterInteraction({ action: 'cancel', state: current })
  if (GREETING.test(raw)) return response('PREFLIGHT_RESPONSE', { reply: 'Hai! Kita bisa atur lokasi, budget, fokus, dan target pasar di sini. Belum ada research yang dijalankan.', state: current })
  if (/^(mulai research|start research|research sekarang)$/i.test(raw)) return response('PREFLIGHT_RESPONSE', { reply: 'Sebelum mulai, tinjau rencana hunting di bawah dan tekan tombol Mulai Research. Tidak ada biaya sebelum konfirmasi itu.', state: { ...current, preflightStep: current.destination ? 'summary' : 'destination' } })

  if (hasBrief) {
    const section = sectionFromText(raw)
    if (section) return response('LOCAL_FILTER', { state: { ...current, activeSection: section }, reply: `Menampilkan bagian ${section.replaceAll('_', ' ')} dari brief tersimpan. Tanpa biaya AI.` })
    const categories = detectHunterCategories(raw)
    const budget = budgetFromIntent(raw, 'done')
    const goal = marketGoal(raw)
    if (categories.length || CATEGORY_ALL.test(raw) || budget != null || goal || /reset filter|tampilkan semua|semua target/i.test(raw)) {
      const next = { ...current }
      if (categories.length) next.categoryFocus = categories
      if (CATEGORY_ALL.test(raw) || /reset filter|tampilkan semua|semua target/i.test(raw)) { next.categoryFocus = []; next.budgetIdr = null; next.marketGoal = 'both'; next.activeSection = 'all' }
      if (budget != null) next.budgetIdr = budget
      if (goal) next.marketGoal = goal
      const reply = categories.length ? `Fokus ${categories.join(' dan ')} diterapkan pada brief tersimpan.` : budget != null ? `Budget ${budget.toLocaleString('id-ID')} perencanaan diterapkan pada brief tersimpan.` : goal ? `Target pasar ${goal} diterapkan pada brief tersimpan.` : 'Filter brief direset.'
      return response('LOCAL_FILTER', { state: next, reply: `${reply} Tanpa web search atau biaya AI.` })
    }
    if (/\b(3 terbaik|tiga terbaik|top\s*3|paling murah|termurah|urutkan murah)\b/i.test(raw)) return response('LOCAL_SORT', { state: current, sort: /murah|termurah/i.test(raw) ? 'cheapest' : 'best', limit: /3 terbaik|tiga terbaik|top\s*3/i.test(raw) ? 3 : null, reply: 'Brief diurutkan dari data yang sudah tersimpan. Tanpa pencarian baru.' })
    if (COMPLEX_QUESTION.test(raw)) return response('AI_CHAT', { state: current, message: raw })
    return response('PREFLIGHT_CLARIFY', { reply: 'Aku bisa mengubah filter dari brief secara gratis. Untuk alasan atau perbandingan yang perlu penalaran, tulis pertanyaan lengkap—misalnya “Kenapa target pertama lebih cocok daripada target kedua?”', state: current })
  }

  const dest = fullDestination(raw, current)
  const budget = budgetFromIntent(raw, current.preflightStep)
  const categories = detectHunterCategories(raw)
  const goal = marketGoal(raw)
  const next = { ...current }
  let changed = ''
  if (dest) { next.destination = dest; changed = 'destination' }
  if (budget != null) { next.budgetIdr = budget; changed = 'budget' }
  if (categories.length || CATEGORY_ALL.test(raw)) { next.categoryFocus = categories; changed = 'category' }
  if (goal) { next.marketGoal = goal; changed = 'market' }
  if (changed) {
    next.preflightStep = stageAfter(next, changed)
    const reply = next.preflightStep === 'budget' ? `Oke, hunting di ${next.destination}. Budget hunting hari ini berapa?`
      : next.preflightStep === 'category' ? 'Mau fokus cari apa?'
        : next.preflightStep === 'market' ? 'Target jualnya ke mana?'
          : `Rencana siap: ${next.destination}${next.budgetIdr ? ` · ${next.budgetIdr.toLocaleString('id-ID')} rupiah` : ''}${next.categoryFocus.length ? ` · ${next.categoryFocus.join(', ')}` : ''} · target pasar ${next.marketGoal}. Tinjau lalu tekan Mulai Research jika sudah yakin.`
    return response('PREFLIGHT_RESPONSE', { state: next, reply })
  }

  if (current.preflightStep === 'budget' && /^(skip|lewati|bebas)$/i.test(raw)) return routeHunterInteraction({ action: 'budget', value: null, state: current })
  if (current.preflightStep === 'category' && CATEGORY_ALL.test(raw)) return routeHunterInteraction({ action: 'category', value: [], state: current })
  if (current.preflightStep === 'market' && /^(skip|bebas)$/i.test(raw)) return routeHunterInteraction({ action: 'market', value: 'both', state: current })
  if (/^budget (?:jadi|ubah ke|maksimal)\b/i.test(raw)) return response('PREFLIGHT_CLARIFY', { reply: 'Tulis batas modal, contoh “300 ribu” atau pilih budget di atas.', state: { ...current, preflightStep: 'budget' } })
  if (/^fokus\b/i.test(raw)) return response('PREFLIGHT_CLARIFY', { reply: 'Pilih salah satu kategori di atas, atau tulis kaos, jaket, sepatu, tas, atau aksesoris.', state: { ...current, preflightStep: 'category' } })
  return response('PREFLIGHT_CLARIFY', { reply: current.destination ? 'Pilih jawaban dari opsi yang tersedia atau beri konteks lebih jelas. Belum ada AI call.' : 'Sebutkan lokasi hunting, misalnya Pajak Melati, Pajak Sambu, atau Carousell. Belum ada AI call.', state: current })
}
