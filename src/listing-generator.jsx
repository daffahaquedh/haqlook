import React, { useMemo, useState } from 'react'
import { AI_ENABLED, supabase } from './supabase-client'
import { LISTING_PROFILES, LISTING_STATUSES, createListingGenerationBody, makeListingSavePayload, needsListingRegenerationConfirmation, normalizeListingResult } from './listing-utils'

function selectionFromSession() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem('haqlooks-listing-marketplaces') || '[]')
    return Array.isArray(saved) ? saved.filter((key) => LISTING_PROFILES.some((profile) => profile.key === key)) : []
  } catch { return [] }
}

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure request IDs are unavailable in this browser.')
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function seededDrafts(item, listings) {
  return Object.fromEntries(LISTING_PROFILES.flatMap((profile) => {
    const listing = listings.find((row) => row.marketplace === profile.marketplace)
    if (!listing || !listing.listing_title) return []
    return [[profile.key, {
      ...normalizeListingResult({
        title: listing.listing_title,
        description: listing.listing_description,
        condition_summary: listing.condition_summary,
        size_display: listing.size_display,
        measurements_text: listing.measurements_text,
        tags: listing.listing_tags,
        warnings: listing.warnings,
      }, item),
      listing_status: listing.listing_status,
      listing_url: listing.listing_url || '',
      asking_price: listing.listed_price ? String(listing.listed_price) : '',
    }]]
  }))
}

export default function ListingGenerator({ item, listings = [], onClose, onSaved }) {
  const [selected, setSelected] = useState(selectionFromSession)
  const [drafts, setDrafts] = useState(() => seededDrafts(item, listings))
  const [activeKey, setActiveKey] = useState(() => Object.keys(seededDrafts(item, listings))[0] || '')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmAgain, setConfirmAgain] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState('info')
  const profileByKey = useMemo(() => Object.fromEntries(LISTING_PROFILES.map((profile) => [profile.key, profile])), [])
  const draftKeys = Object.keys(drafts)
  const activeProfile = profileByKey[activeKey]
  const activeDraft = drafts[activeKey]
  const existingListing = activeProfile ? listings.find((row) => row.marketplace === activeProfile.marketplace) : null

  function announce(message, tone = 'info') { setNotice(message); setNoticeTone(tone) }
  function toggleProfile(key) {
    setSelected((current) => {
      const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
      try { window.sessionStorage.setItem('haqlooks-listing-marketplaces', JSON.stringify(next)) } catch { /* session preference is optional */ }
      return next
    })
  }

  async function generate() {
    if (busy || !selected.length) return
    if (!AI_ENABLED) { announce('AI belum diaktifkan untuk environment ini. Draft yang sudah ada tetap bisa diedit dan disimpan.'); return }
    if (!supabase) { announce('Seller service is not configured.', 'error'); return }
    setBusy(true); setNotice(''); setConfirmAgain(false)
    try {
      const body = createListingGenerationBody(item.id, selected, newRequestId())
      const { data, error } = await supabase.functions.invoke('seller-ai', { body })
      if (error || !data?.ok) throw new Error(data?.message || error?.message || 'AI listing generation failed. Please retry.')
      const generated = data.results || {}
      const next = { ...drafts }
      for (const profile of LISTING_PROFILES.filter(({ key }) => selected.includes(key))) {
        const currentListing = listings.find((row) => row.marketplace === profile.marketplace)
        next[profile.key] = {
          ...generated[profile.key],
          listing_status: currentListing?.listing_status === 'LISTED' ? 'LISTED' : (currentListing?.listing_status === 'REMOVED' ? 'DRAFT' : 'DRAFT'),
          listing_url: currentListing?.listing_url || '',
          asking_price: currentListing?.listed_price ? String(currentListing.listed_price) : String(item.suggested_price || item.price_idr || ''),
        }
      }
      setDrafts(next); setActiveKey(selected[0]); announce('Draft listing siap. Tinjau dan edit sebelum menyalin atau menyimpan.', 'success')
    } catch (error) { announce(error?.message || 'AI listing generation failed. Please retry.', 'error') }
    finally { setBusy(false) }
  }

  function updateDraft(field, value) {
    setDrafts((current) => ({ ...current, [activeKey]: { ...current[activeKey], [field]: value } }))
  }

  async function copy(value, success) {
    try {
      await navigator.clipboard.writeText(value)
      announce(success, 'success')
    } catch { announce('Clipboard access is unavailable. Select and copy the text manually.', 'warning') }
  }

  async function saveDraft() {
    if (!activeDraft || !activeProfile || saving) return
    setSaving(true); setNotice('')
    try {
      const payload = makeListingSavePayload({
        item,
        marketplace: activeProfile.marketplace,
        draft: { ...activeDraft, tags: String(activeDraft.tagsText ?? (activeDraft.tags || []).join(',')).split(',').map((tag) => tag.trim()).filter(Boolean) },
        existing: existingListing,
        listingStatus: activeDraft.listing_status || existingListing?.listing_status || 'DRAFT',
        askingPrice: activeDraft.asking_price,
        listingUrl: activeDraft.listing_url,
      })
      const { error } = await supabase.from('marketplace_listings').upsert(payload, { onConflict: 'product_id,marketplace' })
      if (error) throw error
      announce(`${activeProfile.label} draft tersimpan. Tidak ada panggilan AI tambahan.`, 'success')
      onSaved?.()
    } catch (error) { announce(error?.message || 'Draft could not be saved.', 'error') }
    finally { setSaving(false) }
  }

  const savedMarketplaces = listings.filter((listing) => listing.listing_status === 'LISTED').map((listing) => listing.marketplace)

  return <div className="listing-generator-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="listing-generator-sheet" role="dialog" aria-modal="true" aria-labelledby="listing-generator-title">
      <header className="listing-generator-head"><div><span className="seller-kicker">SELLER TOOL / MANUAL POSTING</span><h2 id="listing-generator-title">Buat Listing <small>/ Generate Listings</small></h2></div><button type="button" className="listing-close" aria-label="Close listing generator" onClick={onClose}>×</button></header>
      <div className="listing-generator-content">
        <div className="listing-product-reference"><div className="listing-product-photos">{(Array.isArray(item.image_urls) ? item.image_urls : []).slice(0, 4).map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${item.name} product reference ${index + 1}`} loading="lazy" />)}</div><div><strong>{item.brand} {item.name}</strong><span>{item.sku || 'SKU pending'} · {item.category || 'Category not set'} · Size {item.size_label || 'not set'}</span></div></div>
        <div className="listing-authenticity-note"><strong>Keaslian belum diverifikasi</strong><span>Authenticity not verified. Manual verification required.</span></div>
        {savedMarketplaces.length > 0 && <div className="listing-active-warning">⚠ Masih LISTED: {savedMarketplaces.map((key) => profileByKey[LISTING_PROFILES.find((profile) => profile.marketplace === key)?.key]?.label || key).join(', ')}. Status eksternal tidak diubah AI; perbarui secara manual.</div>}
      <section className="listing-marketplace-picker"><div><strong>Pilih marketplace</strong><span>Satu permintaan AI untuk semua pilihan yang dicentang.</span></div><div className="listing-profile-options">{LISTING_PROFILES.map((profile) => <label key={profile.key} className={selected.includes(profile.key) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(profile.key)} onChange={() => toggleProfile(profile.key)} /><span><b>{profile.label}</b><small>{profile.language} · {profile.style}</small></span></label>)}</div><button className="seller-primary listing-generate-button" type="button" disabled={busy || !selected.length || !AI_ENABLED || String(item.status).toLowerCase() === 'sold'} onClick={() => needsListingRegenerationConfirmation(draftKeys.length > 0, confirmAgain) ? setConfirmAgain(true) : generate()}>{busy ? 'MEMBUAT DRAFT LISTING…' : confirmAgain ? 'KONFIRMASI BUAT ULANG' : draftKeys.length ? 'GENERATE AGAIN / BUAT ULANG' : 'GENERATE LISTINGS / BUAT DRAFT'}</button>{busy && <p className="listing-activity" role="status">AI sedang menyesuaikan listing untuk marketplace yang dipilih…</p>}{confirmAgain && <div className="listing-regenerate-confirm" role="group"><span>AI akan membuat ulang draft listing untuk marketplace yang dipilih.</span><button type="button" className="seller-secondary" onClick={() => setConfirmAgain(false)}>Cancel</button></div>}{!AI_ENABLED && <p className="listing-activity">AI belum diaktifkan. Draft yang tersimpan tetap dapat diedit, disalin, dan dikelola tanpa biaya AI.</p>}</section>
        {notice && <div className={`seller-notice ${noticeTone}`} role="status">{notice}</div>}
        {draftKeys.length > 0 && <section className="listing-draft-review"><div className="listing-draft-title"><div><span className="seller-kicker">REVIEW BEFORE POSTING</span><h3>Draft Listing</h3></div><span className="listing-manual-badge">POST MANUALLY</span></div>
          <div className="listing-draft-tabs" role="tablist" aria-label="Marketplace drafts">{draftKeys.map((key) => <button type="button" role="tab" aria-selected={activeKey === key} className={activeKey === key ? 'active' : ''} key={key} onClick={() => { setActiveKey(key); setConfirmAgain(false) }}>{profileByKey[key]?.label || key}</button>)}</div>
          {activeDraft && <div className="listing-editor-fields">
            <label>Title<textarea rows="2" maxLength="120" value={activeDraft.title || ''} onChange={(event) => updateDraft('title', event.target.value)} /></label>
            <label>Description<textarea rows="8" maxLength="1800" value={activeDraft.description || ''} onChange={(event) => updateDraft('description', event.target.value)} /></label>
            <label>Tags<textarea rows="2" value={activeDraft.tagsText ?? (activeDraft.tags || []).join(', ')} onChange={(event) => updateDraft('tagsText', event.target.value)} placeholder="Pisahkan dengan koma" /></label>
            <div className="listing-editor-facts"><label>Condition summary<textarea rows="2" value={activeDraft.condition_summary || ''} onChange={(event) => updateDraft('condition_summary', event.target.value)} /></label><label>Size<input value={activeDraft.size_display || ''} onChange={(event) => updateDraft('size_display', event.target.value)} /></label><label>Measurements<textarea rows="2" value={activeDraft.measurements_text || ''} onChange={(event) => updateDraft('measurements_text', event.target.value)} placeholder="Tambahkan manual jika sudah diukur" /></label></div>
            {(activeDraft.warnings || []).length > 0 && <div className="listing-review-warnings"><strong>Catatan untuk ditinjau</strong>{activeDraft.warnings.map((warning, index) => <span key={`${warning}-${index}`}>{warning}</span>)}</div>}
            <div className="listing-copy-actions"><button type="button" className="seller-secondary" onClick={() => copy(activeDraft.title || '', 'Judul disalin.')}>Copy Title</button><button type="button" className="seller-secondary" onClick={() => copy(activeDraft.description || '', 'Deskripsi disalin.')}>Copy Description</button><button type="button" className="seller-secondary" onClick={() => copy((activeDraft.tagsText ?? (activeDraft.tags || []).join(', ')), 'Tags disalin.')}>Copy Tags</button><button type="button" className="seller-secondary" onClick={() => copy(`${activeDraft.title || ''}\n\n${activeDraft.description || ''}\n\n${activeDraft.tagsText ?? (activeDraft.tags || []).join(', ')}`, 'Semua copy listing disalin.')}>Copy All</button></div>
            <div className="listing-save-fields"><label>Status<select value={activeDraft.listing_status || 'DRAFT'} onChange={(event) => updateDraft('listing_status', event.target.value)}>{LISTING_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label><label>Asking price<input inputMode="numeric" type="number" min="0" value={activeDraft.asking_price || ''} onChange={(event) => updateDraft('asking_price', event.target.value)} placeholder="Kosong jika belum ditentukan" /></label><label>Marketplace URL<input type="url" value={activeDraft.listing_url || ''} onChange={(event) => updateDraft('listing_url', event.target.value)} placeholder="https://…" /></label></div>
            {existingListing?.listing_status === 'LISTED' && <p className="listing-active-warning">Listing ini sedang aktif. Menyimpan draft copy tidak mengubah listing eksternal atau menghapus status LISTED.</p>}
            <div className="listing-save-actions"><button type="button" className="seller-primary" onClick={saveDraft} disabled={saving}>{saving ? 'SAVING…' : 'SAVE DRAFT / SIMPAN'}</button><button type="button" className="seller-secondary" onClick={onClose}>Done</button></div>
          </div>}
        </section>}
        <p className="listing-manual-note">AI hanya membuat teks. Posting dilakukan manual di marketplace; harga dan authenticity perlu ditinjau seller. Semua edit, copy, status, URL, dan penyimpanan tidak memanggil AI.</p>
      </div>
    </section>
  </div>
}
