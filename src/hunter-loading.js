const IDLE_ACTIVITY = Object.freeze({ action: null, stageIndex: 0 })

export const HUNTER_ACTIVITY_STAGES = Object.freeze({
  LOAD_CACHE: Object.freeze(['Memeriksa brief tersimpan…']),
  START_RESEARCH: Object.freeze([
    'Memeriksa cache riset…',
    'Mencari referensi pasar terbaru…',
    'Menyusun Hunting Brief…',
  ]),
  REFRESH_RESEARCH: Object.freeze([
    'Menyiapkan refresh riset…',
    'Mencari referensi pasar terbaru…',
    'Menyusun ulang Hunting Brief…',
  ]),
  AI_CHAT: Object.freeze([
    'Memeriksa konteks brief tersimpan…',
    'Menyiapkan jawaban dari brief tersimpan…',
  ]),
  ITEM_CHECK: Object.freeze([
    'Menyiapkan foto untuk dianalisis…',
    'Menganalisis foto barang…',
    'Menyiapkan hasil pemeriksaan…',
  ]),
})

export function beginHunterActivity(current, action) {
  if (current?.action) return current
  if (!HUNTER_ACTIVITY_STAGES[action]) return IDLE_ACTIVITY
  return { action, stageIndex: 0 }
}

export function advanceHunterActivity(current) {
  const stages = HUNTER_ACTIVITY_STAGES[current?.action]
  if (!stages || stages.length < 2) return current?.action ? current : IDLE_ACTIVITY
  return { ...current, stageIndex: (current.stageIndex + 1) % stages.length }
}

export function finishHunterActivity() {
  return IDLE_ACTIVITY
}

export function hunterActivityLabel(activity) {
  const stages = HUNTER_ACTIVITY_STAGES[activity?.action]
  return stages?.[activity.stageIndex] || ''
}

export function isHunterActivityActive(activity, action) {
  return Boolean(activity?.action && (!action || activity.action === action))
}
