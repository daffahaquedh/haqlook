import React, { useEffect, useMemo, useRef, useState } from 'react'
import { HunterAnalyticsPage, HunterChatPage } from './hunter'
import { AI_ENABLED, supabase } from './supabase-client'
import ListingGenerator from './listing-generator'
import './product-detail.css'
import {
  budgetLabel,
  budgetTone,
  calculateProfit,
  analysisSuggestionValue,
  analysisBilingualValue,
  applyItemAnalysisSuggestions,
  canAccessWorkspaceSection,
  INVENTORY_STATUSES,
  ITEM_ANALYSIS_SUGGESTIONS,
  LISTING_STATUSES,
  MARKETPLACES,
  PRODUCT_DETAIL_TABS,
  productDisplayTitle,
  productDetailSubtitle,
  moneyIdr,
  marketplaceStatusLabel,
  productDetailActiveListings,
  productDetailPrimaryAction,
  productDetailTabForKey,
  safeHttpUrl,
  titleCaseStatus,
  workspaceMobileMoreGroupsForRole,
  workspaceNavigationGroupsForRole,
  workspacePathIsActive,
  SELLER_MOBILE_PRIMARY_LINKS,
  workspacePathForLegacyAdmin,
} from './seller-utils'
import {
  CAMERA_PICKER_PROPS,
  GALLERY_PICKER_PROPS,
  MAX_PRODUCT_PHOTOS,
  prepareProductPhoto,
  productPhotoExtension,
  takeAvailablePhotos,
} from './seller-photos'

function go(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function dateLabel(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(value))
}

function imageFor(item) {
  return item?.image_urls?.[0] || '/mascot-latest.png'
}

function errorText(error, fallback = 'Something went wrong. Please try again.') {
  return error?.message || fallback
}

export default function SellerApp({ path }) {
  const [auth, setAuth] = useState({ state: 'loading', user: null, profile: null })

  useEffect(() => {
    let active = true
    async function resolveSession(session) {
      if (!session) {
        if (active) setAuth({ state: 'signed_out', user: null, profile: null })
        return
      }
      const { data: profile, error } = await supabase.from('admins').select('user_id,email,role').eq('user_id', session.user.id).maybeSingle()
      if (!active) return
      if (error || !profile || !['ADMIN', 'SELLER'].includes(String(profile.role || '').toUpperCase())) {
        await supabase.auth.signOut()
        if (active) setAuth({ state: 'signed_out', user: null, profile: null })
        return
      }
      setAuth({ state: 'signed_in', user: session.user, profile: { ...profile, role: String(profile.role).toUpperCase() } })
    }
    async function loadSession() {
      if (!supabase) {
        if (active) setAuth({ state: 'signed_out', user: null, profile: null })
        return
      }
      const { data: { session } } = await supabase.auth.getSession()
      await resolveSession(session)
    }
    loadSession()
    const { data: listener } = supabase?.auth.onAuthStateChange((_event, session) => { setTimeout(() => { void resolveSession(session) }, 0) }) || { data: null }
    return () => { active = false; listener?.subscription?.unsubscribe() }
  }, [])

  if (auth.state === 'loading') return <SellerLoading text="Checking seller access…" />
  if (auth.state !== 'signed_in') return <SellerLogin />
  return <SellerWorkspace path={path} profile={auth.profile} onLogout={async () => { await supabase?.auth.signOut(); go('/seller') }} />
}

function SellerLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setMessage('')
    if (!supabase) {
      setMessage('Seller access is not configured in this environment. Add the Supabase variables first.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage(errorText(error, 'Unable to sign in.'))
    else go('/seller')
    setBusy(false)
  }

  return <main className="seller-auth-page">
    <section className="seller-auth-art"><img src="/mascot-latest.png" alt="HAQLOOKS mascot" /><p>PRE-OWNED SNEAKERS.<br />NEW STORIES.</p></section>
    <section className="seller-auth-card"><span className="seller-kicker">HAQLOOKS / PRIVATE WORKSPACE</span><h1>SELLER<br /><em>PANEL</em></h1><p>Manage the master inventory, sourcing list, listings, and sales from one mobile-first workspace.</p>
      <form onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{message && <Notice tone="error">{message}</Notice>}<button className="seller-primary" disabled={busy}>{busy ? 'SIGNING IN…' : 'SIGN IN →'}</button></form><a className="seller-back" href="/" onClick={(event) => { event.preventDefault(); go('/') }}>← Back to storefront</a>
    </section>
  </main>
}

function SellerWorkspace({ path, profile, onLogout }) {
  const workspacePath = workspacePathForLegacyAdmin(path)
  const [section, id, subSection] = workspacePath.replace(/^\/seller\/?/, '').split('/')
  useEffect(() => {
    if (path === '/admin' && profile.role !== 'ADMIN') go('/seller')
  }, [path, profile.role])
  let page = <SellerDashboard profile={profile} />
  if (!canAccessWorkspaceSection(profile.role, section)) page = <AccessDenied />
  else if (section === 'analytics') page = <SellerDashboard profile={profile} analytics />
  if (section === 'inventory' && id === 'new') page = <NewInventory />
  else if (section === 'inventory' && id && subSection === 'edit') page = <EditInventory id={id} />
  else if (section === 'inventory' && id) page = <InventoryDetail id={id} />
  else if (section === 'inventory') page = <InventoryPage />
  else if (section === 'ai-hunter') page = <HunterChatPage />
  else if (section === 'sourcing') page = <SourcingPage />
  else if (section === 'hunter-analytics' && profile.role === 'ADMIN') page = <HunterAnalyticsPage />
  else if (section === 'listings') page = <ListingsPage />
  else if (section === 'sales') page = <SalesPage />
  else if (section === 'ai-usage' && profile.role === 'ADMIN') page = <AIUsagePage />
  else if (section === 'settings' && profile.role === 'ADMIN') page = <SettingsPage />
  else if (['users-roles', 'marketplace-settings', 'app-settings'].includes(section) && profile.role === 'ADMIN') {
    const titles = { 'users-roles': 'Users / Roles', 'marketplace-settings': 'Marketplace Settings', 'app-settings': 'App Settings' }
    page = <ComingSoonPage title={titles[section]} />
  }
  if (path === '/admin' && profile.role !== 'ADMIN') page = <AccessDenied />
  return <main className="seller-app"><SellerSidebar path={workspacePath} profile={profile} onLogout={onLogout} /><section className="seller-content">{page}</section><SellerMobileNav path={workspacePath} profile={profile} onLogout={onLogout} /></main>
}

function SellerSidebar({ path, profile, onLogout }) {
  const groups = workspaceNavigationGroupsForRole(profile.role)
  return <aside className="seller-sidebar">
    <div className="seller-brand"><img src="/mascot-latest.png" alt="" /><div><strong>HAQLOOKS</strong><span>{profile.role === 'ADMIN' ? 'ADMIN WORKSPACE' : 'SELLER WORKSPACE'}</span></div></div>
    <nav aria-label={`${profile.role} workspace`}>
      {groups.map((group) => <section className="seller-nav-group" key={group.label}>
        <span className="seller-nav-heading">{group.label}</span>
        {group.links.map(([href, label, icon]) => <a key={href} href={href} className={workspacePathIsActive(path, href) ? 'active' : ''} onClick={(event) => { event.preventDefault(); go(href) }}><i>{icon}</i><span>{label}</span></a>)}
      </section>)}
    </nav>
    <div className="seller-user"><span className="role-pill">{profile.role === 'ADMIN' ? 'ADMIN' : 'SELLER'}</span><small>{profile.email || 'Authenticated seller'}</small><button type="button" onClick={onLogout}>↪ Keluar</button></div>
  </aside>
}

function SellerMobileNav({ path, profile, onLogout }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreGroups = workspaceMobileMoreGroupsForRole(profile.role)
  const adminMoreLinks = profile.role === 'ADMIN' ? moreGroups.slice(2).flatMap(({ links }) => links) : []
  function navigate(href) { setMoreOpen(false); go(href) }
  return <>
    {moreOpen && <div className="seller-more-sheet" role="dialog" aria-label="Lainnya">
      <div className="seller-more-head"><div><strong>Lainnya</strong><small>{profile.email || (profile.role === 'ADMIN' ? 'Administrator' : 'Akun seller')}</small></div><button type="button" aria-label="Tutup menu lainnya" onClick={() => setMoreOpen(false)}>×</button></div>
      {moreGroups.map((group) => <section className="seller-more-group" key={group.label}><span>{group.label}</span>{group.links.map(([href, label, icon]) => <a key={href} href={href} className={workspacePathIsActive(path, href) ? 'active' : ''} onClick={(event) => { event.preventDefault(); navigate(href) }}><i>{icon}</i><span>{label}</span></a>)}</section>)}
      <button type="button" className="seller-more-logout" onClick={onLogout}>↪ Keluar</button>
    </div>}
    <nav className="seller-mobile-nav" aria-label="Navigasi seller">
      {SELLER_MOBILE_PRIMARY_LINKS.map(([href, label, icon]) => <a key={href} href={href} className={workspacePathIsActive(path, href) ? 'active' : ''} onClick={(event) => { event.preventDefault(); navigate(href) }}><i>{icon}</i><span>{label}</span></a>)}
      <button type="button" className={moreOpen || adminMoreLinks.some(([href]) => workspacePathIsActive(path, href)) ? 'active' : ''} aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><i>•••</i><span>Lainnya</span></button>
    </nav>
  </>
}

function SellerHeader({ eyebrow, title, copy, action }) {
  return <header className="seller-header"><div><span className="seller-kicker">{eyebrow}</span><h1>{title}</h1>{copy && <p>{copy}</p>}</div>{action}</header>
}

function SellerLoading({ text }) { return <main className="seller-loading"><span className="seller-spinner" /><p>{text}</p></main> }
function Notice({ children, tone = 'info' }) { return <div className={`seller-notice ${tone}`}>{children}</div> }
function AccessDenied() { return <div className="seller-empty"><strong>ADMIN ACCESS REQUIRED</strong><p>This area is limited to ADMIN accounts.</p></div> }
function ComingSoonPage({ title }) { return <div><SellerHeader eyebrow="ADMIN / MANAGEMENT" title={title} copy="Fondasi pengelolaan ini belum tersedia. Tidak ada perubahan yang dilakukan di sini." /><section className="seller-panel"><span className="seller-kicker">COMING SOON / BELUM TERSEDIA</span><h2 className="coming-soon-title">Belum tersedia</h2><p className="seller-muted">Backend dan kontrol akses untuk halaman ini belum disiapkan. Halaman ini hanya penanda status, bukan fitur yang berfungsi.</p></section></div> }

function SellerDashboard({ profile, analytics = false }) {
  const [summary, setSummary] = useState(null)
  const [ai, setAi] = useState(null)
  const [watchlist, setWatchlist] = useState([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function load() {
      if (!supabase) return
      const [{ data: dashboard, error: dashboardError }, { data: usage }, { data: sourcing }] = await Promise.all([
        supabase.rpc('seller_dashboard_summary'),
        supabase.rpc('seller_ai_usage_summary'),
        supabase.from('sourcing_candidates').select('*').in('status', ['WATCHING', 'CHECK', 'NEGOTIATING']).order('created_at', { ascending: false }).limit(4),
      ])
      if (dashboardError) setMessage(errorText(dashboardError, 'Apply the seller panel migration to load live data.'))
      setSummary(dashboard || null); setAi(usage || null); setWatchlist(sourcing || [])
    }
    load()
  }, [])

  const stats = summary || { total_stock: 0, available: 0, draft: 0, reserved: 0, sold: 0, total_modal_active: 0, estimated_stock_value: 0, revenue: 0, gross_profit: 0, net_profit: 0 }
  const tone = budgetTone(ai?.used || 0, ai?.budget || 0)
  return <div><SellerHeader eyebrow={analytics ? 'INSIGHT' : `${profile?.role || 'SELLER'} / OPERASIONAL`} title={analytics ? 'Ringkasan bisnis' : 'Beranda'} copy="Your master inventory is the source of truth for every channel." action={<a href="/seller/inventory/new" className="seller-primary compact" onClick={(event) => { event.preventDefault(); go('/seller/inventory/new') }}>＋ Tambah barang</a>} />{message && <Notice tone="warning">{message}</Notice>}<section className="seller-stat-grid"><Stat label="Total stock" value={stats.total_stock} /><Stat label="Available" value={stats.available} tone="green" /><Stat label="Draft" value={stats.draft} tone="muted" /><Stat label="Reserved" value={stats.reserved} tone="yellow" /><Stat label="Sold" value={stats.sold} tone="red" /></section><section className="seller-finance-grid"><Metric label="Modal active" value={moneyIdr(stats.total_modal_active)} /><Metric label="Estimated stock value" value={moneyIdr(stats.estimated_stock_value)} /><Metric label="Revenue" value={moneyIdr(stats.revenue)} /><Metric label="Gross profit" value={moneyIdr(stats.gross_profit)} /><Metric label="Net profit" value={moneyIdr(stats.net_profit)} /></section><div className="seller-two-col"><section className="seller-panel"><PanelTitle eyebrow="AI BUDGET" title="Monthly usage" href={profile?.role === 'ADMIN' ? '/seller/ai-usage' : undefined} /><div className="budget-row"><strong>{moneyIdr(ai?.used || 0)}</strong><span>of {moneyIdr(ai?.budget || 100000)}</span></div><div className="budget-track"><span className={tone} style={{ width: `${Math.min(ai?.percentage || 0, 100)}%` }} /></div><div className="budget-foot"><span className={`budget-state ${tone}`}>{budgetLabel(ai?.used || 0, ai?.budget || 100000)}</span><span>{Math.round(ai?.percentage || 0)}%</span></div>{!AI_ENABLED && <p className="muted-note">AI belum dikonfigurasi. Usage stays at zero until the server-side function is enabled.</p>}</section><section className="seller-panel"><PanelTitle eyebrow="SOURCING WATCHLIST" title="Candidates to review" href="/seller/sourcing" />{watchlist.length ? watchlist.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} />) : <p className="seller-muted">No sourcing candidates yet.</p>}</section></div></div>
}

function Stat({ label, value, tone = '' }) { return <div className={`seller-stat ${tone}`}><span>{label}</span><strong>{value}</strong></div> }
function Metric({ label, value }) { return <div className="seller-metric"><span>{label}</span><strong>{value}</strong></div> }
function PanelTitle({ eyebrow, title, href }) { return <div className="seller-panel-title"><div><span className="seller-kicker">{eyebrow}</span><h2>{title}</h2></div>{href && <a href={href} onClick={(event) => { event.preventDefault(); go(href) }}>View all →</a>}</div> }
function CandidateRow({ candidate }) { return <a className="candidate-row" href={`/seller/sourcing`} onClick={(event) => { event.preventDefault(); go('/seller/sourcing') }}><div><strong>{candidate.title}</strong><span>{candidate.brand || 'Brand not set'} · {candidate.source_platform || 'Unknown source'}</span></div><b className={`opportunity ${candidate.opportunity_score >= 70 ? 'high' : candidate.opportunity_score >= 40 ? 'check' : 'skip'}`}>{candidate.opportunity_score == null ? '—' : candidate.opportunity_score}</b></a> }

function InventoryPage() {
  const [items, setItems] = useState([]); const [count, setCount] = useState(0); const [filters, setFilters] = useState({ q: '', status: '', brand: '', sort: 'newest' }); const [page, setPage] = useState(0); const [message, setMessage] = useState(''); const pageSize = 20
  useEffect(() => {
    async function load() {
      if (!supabase) return
      let query = supabase.from('products').select('*', { count: 'exact' })
      if (filters.q) query = query.or(`sku.ilike.%${filters.q}%,name.ilike.%${filters.q}%,brand.ilike.%${filters.q}%`)
      if (filters.status) query = query.eq('status', filters.status)
      if (filters.brand) query = query.ilike('brand', `%${filters.brand}%`)
      query = query.order(filters.sort === 'oldest' ? 'created_at' : filters.sort === 'capital' ? 'purchase_price' : 'created_at', { ascending: filters.sort === 'oldest' })
      const { data, count: total, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) setMessage(errorText(error)); else { setItems(data || []); setCount(total || 0); setMessage('') }
    }
    load()
  }, [filters, page])
  function update(key, value) { setPage(0); setFilters((current) => ({ ...current, [key]: value })) }
  return <div><SellerHeader eyebrow="MASTER DATABASE" title="Barang" copy="One SKU, one source of truth. Keep every channel downstream from this list." action={<a href="/seller/inventory/new" className="seller-primary compact" onClick={(event) => { event.preventDefault(); go('/seller/inventory/new') }}>＋ Tambah barang</a>} />{message && <Notice tone="error">{message}</Notice>}<section className="inventory-toolbar"><input value={filters.q} onChange={(event) => update('q', event.target.value)} placeholder="Search SKU, brand, title…" /><select value={filters.status} onChange={(event) => update('status', event.target.value)}><option value="">All status</option>{INVENTORY_STATUSES.map((status) => <option key={status} value={status}>{titleCaseStatus(status)}</option>)}</select><input value={filters.brand} onChange={(event) => update('brand', event.target.value)} placeholder="Brand filter" /><select value={filters.sort} onChange={(event) => update('sort', event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="capital">Highest capital</option></select></section><div className="inventory-count">{count} records · page {page + 1}</div><section className="inventory-list">{items.length ? items.map((item) => <InventoryCard key={item.id} item={item} />) : <div className="seller-empty"><strong>NO INVENTORY FOUND</strong><p>Add the first item or adjust your filters.</p></div>}</section><div className="pagination"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>← Previous</button><button type="button" disabled={(page + 1) * pageSize >= count} onClick={() => setPage((value) => value + 1)}>Next →</button></div></div>
}

function InventoryCard({ item }) { return <a href={`/seller/inventory/${item.id}`} className="inventory-card" onClick={(event) => { event.preventDefault(); go(`/seller/inventory/${item.id}`) }}><img src={imageFor(item)} alt="" /><div className="inventory-card-main"><div className="inventory-card-top"><span className="sku">{item.sku || 'SKU pending'}</span><span className={`inventory-status ${item.status}`}>{titleCaseStatus(item.status)}</span></div><h2>{item.brand} {item.name}</h2><p>{item.size_label || 'Size not set'} · {item.condition || 'Condition not set'}</p><div className="inventory-card-bottom"><strong>{moneyIdr(item.purchase_price)}</strong><span>Sell {moneyIdr(item.suggested_price || item.price_idr)}</span></div></div></a> }

function NewInventory() {
  const [form, setForm] = useState({ brand: '', name: '', category: '', subcategory: '', size_label: '', condition: 'Good', condition_notes: '', defects: '', purchase_price: '', suggested_price: '', minimum_price: '', source: '', source_url: '', purchase_date: today(), status: 'draft', description: '' })
  const [photos, setPhotos] = useState([]); const photosRef = useRef([])
  const [message, setMessage] = useState(''); const [photoMessage, setPhotoMessage] = useState(''); const [photoBusy, setPhotoBusy] = useState(false); const [busy, setBusy] = useState(false)
  const cameraPicker = useRef(null); const galleryPicker = useRef(null)
  function set(key, value) { setForm((current) => ({ ...current, [key]: value })) }
  function replacePhotos(next) {
    const keep = new Set(next.map((photo) => photo.preview))
    photosRef.current.forEach((photo) => { if (!keep.has(photo.preview)) URL.revokeObjectURL(photo.preview) })
    photosRef.current = next
    setPhotos(next)
  }
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.preview)), [])

  async function chooseFiles(event) {
    const input = event.currentTarget
    const selected = [...(input.files || [])]
    input.value = ''
    setPhotoMessage('')
    if (!selected.length) return

    const { files: available, omitted } = takeAvailablePhotos(photosRef.current.length, selected)
    const limitMessage = omitted ? `Maksimal ${MAX_PRODUCT_PHOTOS} foto. ${omitted} foto tidak ditambahkan.` : ''
    if (limitMessage) setPhotoMessage(limitMessage)
    if (!available.length) return

    setPhotoBusy(true)
    const prepared = []; const errors = []
    for (const candidate of available) {
      try { prepared.push(await prepareProductPhoto(candidate)) }
      catch (error) { errors.push(error.message || 'Foto tidak dapat diproses.') }
    }
    const additions = prepared.map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }))
    replacePhotos([...photosRef.current, ...additions])
    if (errors.length) setPhotoMessage([limitMessage, ...errors].filter(Boolean).join(' '))
    setPhotoBusy(false)
  }

  function removePhoto(photoId) {
    replacePhotos(photosRef.current.filter((photo) => photo.id !== photoId))
  }
  async function upload() {
    const urls = []
    for (const { file } of photosRef.current) {
      const extension = productPhotoExtension(file)
      const path = `inventory/${crypto.randomUUID()}.${extension}`
      const contentType = file.type || (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg')
      const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert: false, contentType })
      if (error) throw error
      urls.push(supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl)
    }
    return urls
  }
  async function save(event) {
    event.preventDefault(); setMessage('')
    if (photoBusy) return
    if (!supabase) { setMessage('Supabase is not configured.'); return }
    if (form.source_url && !safeHttpUrl(form.source_url)) { setMessage('Source URL must use http:// or https://.'); return }
    setBusy(true)
    try {
      const imageUrls = await upload()
      const payload = { ...form, slug: `${form.brand}-${form.name}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), price_idr: Number(form.suggested_price || 0), purchase_price: Number(form.purchase_price || 0), suggested_price: Number(form.suggested_price || 0), minimum_price: Number(form.minimum_price || 0), image_urls: imageUrls, is_published: form.status === 'available', featured: false, model: null, price_usd: null, size_label: form.size_label || null, condition_notes: form.condition_notes || null, defects: form.defects || null, source: form.source || null, source_url: form.source_url ? safeHttpUrl(form.source_url) : null, description: form.description || null }
      const { data, error } = await supabase.from('products').insert(payload).select('id').single()
      if (error) throw error
      go(`/seller/inventory/${data.id}`)
    } catch (error) { setMessage(errorText(error, 'Unable to save this item.')) }
    setBusy(false)
  }
  return <div><SellerHeader eyebrow="MASTER DATABASE / NEW ITEM" title="Tambah barang" copy="Capture the item in HAQLOOKS before analysing or distributing it." action={<button className="seller-secondary compact" type="button" onClick={() => go('/seller/inventory')}>Cancel</button>} />{message && <Notice tone="error">{message}</Notice>}<form className="seller-form" onSubmit={save}>
    <section className="seller-panel"><PanelTitle eyebrow="01 / FOTO BARANG" title="Product photos" /><p className="photo-picker-copy">Ambil foto atau pilih beberapa foto produk dari galeri. Detail label, jahitan, motif, dan kondisi tetap penting.</p><div className="photo-uploader"><div className="photo-preview-grid">{photos.length ? photos.map((photo, index) => <div className="photo-preview" key={photo.id}><img src={photo.preview} alt={`Product photo preview ${index + 1}`} /><button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => removePhoto(photo.id)}>×</button></div>) : <div className="photo-empty"><strong>Belum ada foto / No photos yet</strong><span>Foto terang dan tajam membantu memeriksa tag, stitching, print, serta defect.</span></div>}</div><div className="photo-picker-actions">
      <input className="photo-picker-input" {...CAMERA_PICKER_PROPS} ref={cameraPicker} aria-label="Take a product photo" tabIndex={-1} onChange={chooseFiles} />
      <input className="photo-picker-input" {...GALLERY_PICKER_PROPS} ref={galleryPicker} aria-label="Choose product photos from gallery" tabIndex={-1} onChange={chooseFiles} />
      <button className="photo-picker-action" type="button" onClick={() => cameraPicker.current?.click()} disabled={photoBusy || photos.length >= MAX_PRODUCT_PHOTOS}><span>📷 Ambil Foto</span><small>Take Photo</small></button>
      <button className="photo-picker-action gallery" type="button" onClick={() => galleryPicker.current?.click()} disabled={photoBusy || photos.length >= MAX_PRODUCT_PHOTOS}><span>🖼 Pilih dari Galeri</span><small>Choose from Gallery</small></button>
      <div className="photo-count" aria-live="polite">{photos.length} / {MAX_PRODUCT_PHOTOS} foto dipilih <span>/ photos selected</span>{photoBusy && <b> · Memproses foto… / Processing…</b>}</div>
      {photoMessage && <p className="photo-picker-error" role="alert">{photoMessage}</p>}
    </div></div></section>
    <section className="seller-panel"><PanelTitle eyebrow="02 / IDENTITY" title="Basic information" /><div className="seller-fields two"><Field label="Brand" value={form.brand} onChange={(value) => set('brand', value)} required placeholder="Stussy" /><Field label="Item name" value={form.name} onChange={(value) => set('name', value)} required placeholder="Work Jacket" /><Field label="Category" value={form.category} onChange={(value) => set('category', value)} placeholder="Jackets" /><Field label="Subcategory" value={form.subcategory} onChange={(value) => set('subcategory', value)} placeholder="Workwear" /><Field label="Size" value={form.size_label} onChange={(value) => set('size_label', value)} placeholder="L / 42" /><Field label="Condition" value={form.condition} onChange={(value) => set('condition', value)} placeholder="Excellent" /><Field label="Condition notes" value={form.condition_notes} onChange={(value) => set('condition_notes', value)} placeholder="Light wear on cuff" /><Field label="Defects / minus" value={form.defects} onChange={(value) => set('defects', value)} placeholder="None" /></div></section>
    <section className="seller-panel"><PanelTitle eyebrow="03 / MONEY" title="Capital & pricing" /><div className="seller-fields three"><Field label="Purchase price" value={form.purchase_price} onChange={(value) => set('purchase_price', value)} type="number" required placeholder="750000" /><Field label="Suggested price" value={form.suggested_price} onChange={(value) => set('suggested_price', value)} type="number" placeholder="2250000" /><Field label="Minimum price" value={form.minimum_price} onChange={(value) => set('minimum_price', value)} type="number" placeholder="1900000" /></div></section>
    <section className="seller-panel"><PanelTitle eyebrow="04 / SOURCE" title="Where it came from" /><div className="seller-fields two"><Field label="Source" value={form.source} onChange={(value) => set('source', value)} placeholder="Hunting / seller name" /><Field label="Source URL" value={form.source_url} onChange={(value) => set('source_url', value)} placeholder="https://…" /><Field label="Purchase date" value={form.purchase_date} onChange={(value) => set('purchase_date', value)} type="date" /><label>Status<select value={form.status} onChange={(event) => set('status', event.target.value)}><option value="draft">Save as draft</option><option value="available">Save & available</option></select></label><Field label="Description" value={form.description} onChange={(value) => set('description', value)} textarea placeholder="The customer-facing story for this item…" /></div></section>
    <div className="seller-form-actions"><button className="seller-primary" disabled={busy || photoBusy}>{busy ? 'SAVING…' : form.status === 'available' ? 'SAVE & AVAILABLE →' : 'SAVE AS DRAFT →'}</button><button type="button" className="seller-secondary" onClick={() => go('/seller/inventory')}>Cancel</button></div></form></div>
}

function Field({ label, value, onChange, type = 'text', placeholder, required = false, textarea = false, name }) { return <label>{label}{textarea ? <textarea name={name} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} placeholder={placeholder} rows="4" required={required} /> : <input name={name} type={type} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} placeholder={placeholder} required={required} />}</label> }

function InventoryDetail({ id }) {
  const [item, setItem] = useState(null); const [listings, setListings] = useState([]); const [sales, setSales] = useState([]); const [message, setMessage] = useState(''); const [editingListing, setEditingListing] = useState(null); const [showSold, setShowSold] = useState(false); const [showListingGenerator, setShowListingGenerator] = useState(false); const [analysis, setAnalysis] = useState(null); const [lastAnalysis, setLastAnalysis] = useState(null); const [analysisApplied, setAnalysisApplied] = useState(false); const [analysisBusy, setAnalysisBusy] = useState(false); const [analysisMessage, setAnalysisMessage] = useState(''); const [selectedSuggestions, setSelectedSuggestions] = useState({}); const [activeTab, setActiveTab] = useState('summary'); const tabRefs = useRef({})
  async function load() {
    if (!supabase) return
    const [{ data: product, error }, { data: listingData }, { data: saleData }] = await Promise.all([
      supabase.from('products').select('*').eq('id', id).single(),
      supabase.from('marketplace_listings').select('*').eq('product_id', id).order('marketplace'),
      supabase.from('sales').select('*').eq('product_id', id).order('sold_at', { ascending: false }),
    ])
    if (error) setMessage(errorText(error, 'Inventory item not found.')); else { setItem(product); setListings(listingData || []); setSales(saleData || []) }
  }
  useEffect(() => { setActiveTab('summary'); setMessage(''); setAnalysis(null); setLastAnalysis(null); setAnalysisApplied(false); setAnalysisMessage(''); setSelectedSuggestions({}); setEditingListing(null); setShowSold(false); setShowListingGenerator(false); load() }, [id])
  function handleTabKeyDown(event, tabId) {
    const nextTab = productDetailTabForKey(tabId, event.key)
    if (nextTab === tabId || !PRODUCT_DETAIL_TABS.some((tab) => tab.id === nextTab)) return
    event.preventDefault()
    setActiveTab(nextTab)
    requestAnimationFrame(() => tabRefs.current[nextTab]?.focus())
  }
  async function analyzeItem() {
    if (!AI_ENABLED) { setAnalysisMessage('AI belum diaktifkan. Inventory tetap dapat digunakan.'); return }
    if (!supabase) { setAnalysisMessage('Supabase is not configured in this environment.'); return }
    setAnalysisMessage(''); setAnalysisBusy(true)
    const { data, error } = await supabase.functions.invoke('seller-ai', { body: { feature: 'ITEM_ANALYSIS', product_id: id } })
    if (error || !data?.ok) {
      setAnalysisMessage(data?.message || errorText(error, 'AI analysis failed.'))
    } else {
      const result = data.result || {}
      const defaults = Object.fromEntries(ITEM_ANALYSIS_SUGGESTIONS.map(({ key }) => [key, Boolean(analysisSuggestionValue(result, key))]))
      setSelectedSuggestions(defaults); setLastAnalysis(data); setAnalysisApplied(false); setAnalysis(data)
    }
    setAnalysisBusy(false)
  }
  async function applyAnalysis() {
    const next = applyItemAnalysisSuggestions(item, analysis?.result, selectedSuggestions)
    const updates = {}
    ITEM_ANALYSIS_SUGGESTIONS.forEach(({ target }) => { if (next[target] !== item[target]) updates[target] = next[target] })
    if (!Object.keys(updates).length) { setAnalysisMessage('Select at least one suggestion to apply.'); return }
    setAnalysisBusy(true)
    const { data, error } = await supabase.from('products').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
    if (error) setAnalysisMessage(errorText(error, 'Could not apply suggestions.'))
    else { setItem(data); setAnalysis(null); setAnalysisApplied(true); setAnalysisMessage('Saran terpilih diterapkan. Periksa kembali data barang sebelum melanjutkan.') }
    setAnalysisBusy(false)
  }
  async function saveListing(event) {
    event.preventDefault(); const form = editingListing
    if (!form) return
    if (form.listing_url && !safeHttpUrl(form.listing_url)) { setMessage('Listing URL must use http:// or https://.'); return }
    const { error } = await supabase.from('marketplace_listings').upsert({ product_id: id, marketplace: form.marketplace, listing_status: form.listing_status, listing_url: form.listing_url ? safeHttpUrl(form.listing_url) : null, listed_price: Number(form.listed_price || 0), listed_at: form.listed_at || (form.listing_status === 'LISTED' ? new Date().toISOString() : null), last_updated: new Date().toISOString() }, { onConflict: 'product_id,marketplace' })
    if (error) setMessage(errorText(error)); else { setEditingListing(null); load() }
  }
  async function markSold(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const values = Object.fromEntries(form.entries())
    const profit = calculateProfit({ salePrice: values.sale_price, purchasePrice: item.purchase_price, marketplaceFee: values.marketplace_fee, paymentFee: values.payment_fee, shippingSubsidy: values.shipping_subsidy, otherCost: values.other_cost })
    const { error } = await supabase.rpc('mark_product_sold', { p_product_id: id, p_sold_via: values.sold_via, p_sale_price: Number(values.sale_price || 0), p_marketplace_fee: Number(values.marketplace_fee || 0), p_payment_fee: Number(values.payment_fee || 0), p_shipping_subsidy: Number(values.shipping_subsidy || 0), p_other_cost: Number(values.other_cost || 0), p_notes: values.notes || null })
    if (error) setMessage(errorText(error, 'Could not mark this item sold.')); else { setShowSold(false); setMessage(`Sold recorded. Gross profit ${moneyIdr(profit.grossProfit)}, net profit ${moneyIdr(profit.netProfit)}.`); load() }
  }
  if (!item) return message ? <div className="seller-empty"><strong>{message}</strong><button className="seller-secondary" onClick={() => go('/seller/inventory')}>← Kembali ke Barang</button></div> : <SellerLoading text="Memuat barang…" />
  const isSold = String(item.status || '').toLowerCase() === 'sold'
  const activeListings = productDetailActiveListings(listings, sales[0]?.sold_via)
  const primaryAction = productDetailPrimaryAction(item, listings)
  function runPrimaryAction() {
    if (primaryAction.kind === 'complete') { go(`/seller/inventory/${id}/edit`); return }
    if (primaryAction.kind === 'generator') { setActiveTab('marketplace'); setShowListingGenerator(true); return }
    setActiveTab(primaryAction.target)
  }
  const primaryButton = primaryAction.kind === 'complete'
    ? <a className="seller-primary product-primary-action" href={`/seller/inventory/${id}/edit`} onClick={(event) => { event.preventDefault(); runPrimaryAction() }}>{primaryAction.label}</a>
    : <button type="button" className="seller-primary product-primary-action" onClick={runPrimaryAction}>{primaryAction.label}</button>

  return <main className="product-workspace" aria-labelledby="product-workspace-title">
    <header className="product-workspace-header">
      <a className="product-back-link" href="/seller/inventory" onClick={(event) => { event.preventDefault(); go('/seller/inventory') }}>← Barang</a>
      <div className="product-heading-row">
        <div className="product-heading-copy"><span className="seller-kicker">BARANG / {item.sku || 'SKU pending'}</span><h1 id="product-workspace-title">{productDisplayTitle(item)}</h1><p>{productDetailSubtitle(item)}</p></div>
        <span className={`inventory-status large ${String(item.status || '').toLowerCase()}`}>{titleCaseStatus(item.status)}</span>
      </div>
      <div className="product-action-bar">{primaryButton}<button type="button" className="seller-secondary product-secondary-action" onClick={analyzeItem} aria-disabled={!AI_ENABLED}>{analysisBusy ? 'Sedang menganalisis…' : '✦ Cek dengan AI'}</button></div>
    </header>

    {message && <Notice tone={message.startsWith('Sold recorded') ? 'success' : 'warning'}>{message}</Notice>}
    {analysisMessage && <Notice tone="info">{analysisMessage}</Notice>}
    {isSold && activeListings.length > 0 && <Notice tone="warning">Barang ini sudah terjual. Periksa listing marketplace berikut secara manual: {activeListings.map((listing) => marketplaceStatusLabel(listing.marketplace)).join(', ')}. Listing tidak dihapus otomatis.</Notice>}

    <div className="product-detail-tabs" role="tablist" aria-label="Bagian detail barang">
      {PRODUCT_DETAIL_TABS.map((tab) => <button key={tab.id} ref={(element) => { tabRefs.current[tab.id] = element }} type="button" role="tab" id={`product-tab-${tab.id}`} aria-controls={`product-panel-${tab.id}`} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => handleTabKeyDown(event, tab.id)}>{tab.label}</button>)}
    </div>
    <section className="product-tab-panel" id={`product-panel-${activeTab}`} role="tabpanel" aria-labelledby={`product-tab-${activeTab}`} tabIndex={0}>
      {activeTab === 'summary' && <ProductSummaryTab item={item} analysis={lastAnalysis} analysisApplied={analysisApplied} onEdit={() => go(`/seller/inventory/${id}/edit`)} onReviewAnalysis={() => setAnalysis(lastAnalysis)} />}
      {activeTab === 'marketplace' && <ProductMarketplaceTab item={item} listings={listings} onGenerate={() => setShowListingGenerator(true)} onEdit={(listing) => setEditingListing({ ...listing })} />}
      {activeTab === 'sales' && <ProductSalesTab item={item} sale={sales[0]} onMarkSold={() => setShowSold(true)} />}
    </section>

    {showListingGenerator && <ListingGenerator item={item} listings={listings} onClose={() => setShowListingGenerator(false)} onSaved={load} />}
    {editingListing && <div className="seller-modal-bg product-workspace-modal-bg"><form className="seller-modal listing-edit-modal product-workspace-modal" onSubmit={saveListing}><div className="modal-head"><h2>{marketplaceStatusLabel(editingListing.marketplace)} · listing</h2><button type="button" aria-label="Tutup edit listing" onClick={() => setEditingListing(null)}>×</button></div><label>Status<select value={editingListing.listing_status} onChange={(event) => setEditingListing({ ...editingListing, listing_status: event.target.value })}>{LISTING_STATUSES.map((status) => <option key={status} value={status}>{marketplaceStatusLabel(status)}</option>)}</select></label><label>Harga listing<input type="number" value={editingListing.listed_price || ''} onChange={(event) => setEditingListing({ ...editingListing, listed_price: event.target.value })} /></label><label>URL listing<input value={editingListing.listing_url || ''} onChange={(event) => setEditingListing({ ...editingListing, listing_url: event.target.value })} placeholder="https://…" /></label><div className="seller-form-actions"><button className="seller-primary">Simpan</button><button type="button" className="seller-secondary" onClick={() => setEditingListing(null)}>Batal</button></div></form></div>}
    {analysis && <ItemAnalysisReview analysis={analysis} selected={selectedSuggestions} onSelect={setSelectedSuggestions} onApply={applyAnalysis} onRetry={analyzeItem} onCancel={() => setAnalysis(null)} busy={analysisBusy} />}
    {showSold && <div className="seller-modal-bg product-workspace-modal-bg"><form className="seller-modal product-workspace-modal product-sale-modal" onSubmit={markSold}><div className="modal-head"><h2>Catat terjual</h2><button type="button" aria-label="Tutup pencatatan penjualan" onClick={() => setShowSold(false)}>×</button></div><p className="seller-muted">Status barang dan catatan penjualan diperbarui. Listing eksternal tidak akan diubah otomatis.</p><label>Terjual melalui<select name="sold_via" defaultValue="HAQLOOKS">{MARKETPLACES.map((marketplace) => <option key={marketplace.key} value={marketplace.key}>{marketplace.label}</option>)}<option value="OTHER">Lainnya</option></select></label><Field label="Harga jual" name="sale_price" type="number" placeholder="2250000" required /><div className="seller-fields two"><Field label="Biaya marketplace" name="marketplace_fee" type="number" placeholder="0" /><Field label="Biaya pembayaran" name="payment_fee" type="number" placeholder="0" /><Field label="Subsidi ongkir" name="shipping_subsidy" type="number" placeholder="0" /><Field label="Biaya lain" name="other_cost" type="number" placeholder="0" /></div><label>Catatan<textarea name="notes" rows="3" placeholder="Catatan penjualan (opsional)" /></label><div className="seller-form-actions"><button className="seller-danger-button">Simpan penjualan</button><button type="button" className="seller-secondary" onClick={() => setShowSold(false)}>Batal</button></div></form></div>}
  </main>
}

function ProductSummaryTab({ item, analysis, analysisApplied, onEdit, onReviewAnalysis }) {
  const result = analysis?.result || {}
  const conditionSummary = analysisBilingualValue(result, 'condition_summary').id
  const aiTitle = analysisBilingualValue(result, 'suggested_title').id
  const aiBrand = analysisBilingualValue(result, 'detected_brand').id
  const aiDefects = analysisBilingualValue(result, 'visible_defects').id
  return <div className="product-summary-grid">
    <section className="seller-panel product-item-panel">
      <div className="product-photo-frame"><img src={imageFor(item)} alt={productDisplayTitle(item)} /></div>
      <div className="product-item-content">
        <div className="product-facts-grid"><ProductDetailFact label="Merek" value={item.brand} /><ProductDetailFact label="Kategori" value={item.category} /><ProductDetailFact label="Ukuran" value={item.size_label} /><ProductDetailFact label="Kondisi" value={item.condition} />{item.color && <ProductDetailFact label="Warna" value={item.color} />}{item.material && <ProductDetailFact label="Material" value={item.material} />}</div>
        <div className="product-money-grid"><ProductDetailFact label="Modal" value={moneyIdr(item.purchase_price)} /><ProductDetailFact label="Harga target" value={moneyIdr(item.suggested_price || item.price_idr)} /><ProductDetailFact label="Harga minimum" value={moneyIdr(item.minimum_price)} /></div>
        <div className="product-source-line"><span>Dibeli {dateLabel(item.purchase_date)}</span>{item.source && <span>Sumber: {item.source}</span>}{item.source_url && safeHttpUrl(item.source_url) && <a href={safeHttpUrl(item.source_url)} target="_blank" rel="noreferrer">Buka sumber ↗</a>}</div>
        <button type="button" className="seller-secondary product-edit-link" onClick={onEdit}>Edit barang</button>
      </div>
    </section>
    <div className="product-summary-side">
      <section className="seller-panel product-notes-panel"><PanelTitle eyebrow="KONDISI" title="Kondisi & catatan" />
        <ProductNote label="Catatan kondisi" value={item.condition_notes} />
        <ProductNote label="Kekurangan / defect" value={item.defects} />
        <ProductNote label="Catatan seller" value={item.description} />
        {!item.condition_notes && !item.defects && !item.description && <p className="seller-muted">Belum ada catatan kondisi atau defect.</p>}
      </section>
      <section className="seller-panel product-ai-summary"><PanelTitle eyebrow="ANALISIS BARANG" title="Cek dengan AI" />
        <span className={`product-ai-state ${analysis ? 'complete' : 'empty'}`}>{analysis ? (analysisApplied ? 'Saran terakhir sudah diterapkan' : 'Analisis tersedia untuk ditinjau') : 'Belum dianalisis di sesi ini'}</span>
        {analysis && <><div className="product-ai-highlights">{aiBrand && <p><span>Merek</span><strong>{aiBrand}</strong></p>}{aiTitle && <p><span>Judul</span><strong>{aiTitle}</strong></p>}{conditionSummary && <p><span>Kondisi</span><strong>{conditionSummary}</strong></p>}{aiDefects && <p><span>Defect terlihat</span><strong>{aiDefects}</strong></p>}</div><p className="product-authenticity-note">{result.authenticity_note || 'Keaslian belum diverifikasi. Perlu pemeriksaan manual.'}</p>{!analysisApplied && <button type="button" className="seller-secondary product-review-ai" onClick={onReviewAnalysis}>Tinjau saran AI</button>}</>}
        {!analysis && <p className="seller-muted">AI hanya berjalan saat tombol “Cek dengan AI” ditekan. Membuka atau mengganti tab tidak memanggil AI.</p>}
      </section>
    </div>
  </div>
}

function ProductDetailFact({ label, value }) { return <div className="product-detail-fact"><span>{label}</span><strong>{value || '—'}</strong></div> }

function ProductNote({ label, value }) {
  const [expanded, setExpanded] = useState(false)
  if (!value) return null
  const text = String(value)
  return <div className="product-note-block"><span>{label}</span><p className={expanded ? 'expanded' : ''}>{text}</p>{text.length > 140 && <button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>{expanded ? 'Tampilkan lebih sedikit' : 'Lihat catatan lengkap'}</button>}</div>
}

function ProductMarketplaceTab({ item, listings, onGenerate, onEdit }) {
  const isSold = String(item.status || '').toLowerCase() === 'sold'
  return <div className="product-marketplace-workspace">
    <section className="seller-panel product-marketplace-intro"><div><span className="seller-kicker">DISTRIBUSI PER BARANG</span><h2>Marketplace</h2><p>Kelola status untuk barang ini. Posting dan penghapusan listing tetap manual.</p></div>{!isSold && <button className="seller-primary product-generator-action" type="button" onClick={onGenerate}>✦ Buat listing</button>}</section>
    {isSold && <Notice tone="warning">Barang ini sudah terjual. Jangan buat listing baru; periksa dan perbarui listing yang masih tayang secara manual.</Notice>}
    <div className="product-marketplace-grid">{MARKETPLACES.map((marketplace) => {
      const listing = listings.find((entry) => entry.marketplace === marketplace.key) || { marketplace: marketplace.key, listing_status: 'NOT_LISTED', listed_price: 0, listing_url: '' }
      const safeUrl = safeHttpUrl(listing.listing_url)
      return <article className="product-marketplace-card" key={marketplace.key}>
        <div className="product-marketplace-card-head"><div><span className="seller-kicker">KANAL</span><h3>{marketplace.label}</h3></div><span className={`product-marketplace-status ${String(listing.listing_status).toLowerCase()}`}><i aria-hidden="true" />{marketplaceStatusLabel(listing.listing_status)}</span></div>
        <div className="product-marketplace-price"><span>Harga listing</span><strong>{Number(listing.listed_price || 0) > 0 ? moneyIdr(listing.listed_price) : 'Belum diatur'}</strong></div>
        <p className={`product-marketplace-copy-state ${listing.listing_title || listing.listing_description ? 'available' : ''}`} aria-label="Status copy listing">{listing.listing_title || listing.listing_description ? 'Copy listing tersedia' : 'Belum ada copy tersimpan'}</p>
        <p className="product-marketplace-updated">{listing.last_updated ? `Diperbarui ${dateLabel(listing.last_updated)}` : 'Belum ada aktivitas listing'}</p>
        <div className="product-marketplace-actions">{safeUrl ? <a className="seller-secondary" href={safeUrl} target="_blank" rel="noreferrer">Buka listing ↗</a> : <span className="product-marketplace-no-url">{listing.listing_status === 'NOT_LISTED' ? 'Belum ada URL listing' : 'URL belum dicatat'}</span>}<button type="button" className="seller-secondary" onClick={() => onEdit(listing)}>Edit</button></div>
      </article>
    })}</div>
  </div>
}

function ProductSalesTab({ item, sale, onMarkSold }) {
  const isSold = String(item.status || '').toLowerCase() === 'sold'
  return <div className="product-sales-workspace">
    {!isSold ? <section className="seller-panel product-unsold-state"><span className="product-sale-state-label">BELUM TERJUAL</span><h2>Barang masih tersedia</h2><p>Catat penjualan setelah transaksi selesai. Perhitungan laba menggunakan modal barang dan biaya yang dicatat.</p><div className="product-sale-baseline"><ProductDetailFact label="Modal barang" value={moneyIdr(item.purchase_price)} /><ProductDetailFact label="Harga target" value={moneyIdr(item.suggested_price || item.price_idr)} /></div><button type="button" className="seller-danger-button product-record-sale" onClick={onMarkSold}>Catat terjual</button></section>
      : <section className="seller-panel product-sold-state"><div className="product-sold-heading"><span className="product-sale-state-label">TERJUAL</span><h2>Ringkasan penjualan</h2></div>{sale ? <><div className="product-sale-meta"><span>Melalui {marketplaceStatusLabel(sale.sold_via)}</span><span>{dateLabel(sale.sold_at)}</span></div><div className="product-sale-metrics"><ProductDetailFact label="Harga jual" value={moneyIdr(sale.sale_price)} /><ProductDetailFact label="Modal" value={moneyIdr(sale.purchase_price ?? item.purchase_price)} /><ProductDetailFact label="Laba kotor" value={moneyIdr(sale.gross_profit)} /><ProductDetailFact label="Laba bersih" value={moneyIdr(sale.net_profit)} /><ProductDetailFact label="Biaya marketplace" value={moneyIdr(sale.marketplace_fee)} /><ProductDetailFact label="Biaya pembayaran" value={moneyIdr(sale.payment_fee)} /><ProductDetailFact label="Subsidi ongkir" value={moneyIdr(sale.shipping_subsidy)} /><ProductDetailFact label="Biaya lain" value={moneyIdr(sale.other_cost)} /></div>{sale.notes && <ProductNote label="Catatan penjualan" value={sale.notes} />}</> : <p className="seller-muted">Barang berstatus terjual, tetapi detail transaksinya tidak tersedia.</p>}</section>}
  </div>
}

function ItemAnalysisReview({ analysis, selected, onSelect, onApply, onRetry, onCancel, busy }) {
  const result = analysis.result || {}
  const recommendation = Array.isArray(result.marketplace_recommendations) ? result.marketplace_recommendations : []
  const notes = analysisBilingualValue(result, 'seller_notes')

  return <div className="seller-modal-bg ai-analysis-bg">
    <section className="seller-modal ai-analysis-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-analysis-title">
      <div className="modal-head"><div><span className="seller-kicker">ITEM ANALYSIS / ANALISIS ITEM</span><h2 id="ai-analysis-title">Tinjau saran AI <small>Review AI suggestions</small></h2></div><button type="button" aria-label="Close analysis" onClick={onCancel}>×</button></div>
      <p className="seller-muted">Saran tidak mengubah produk otomatis. Pilih kolom yang ingin diterapkan setelah ditinjau.<span> / Suggestions never overwrite the item automatically. Select fields to apply after review.</span></p>

      <section className="ai-review-section"><h3>Identifikasi <small>/ Identification</small></h3><div className="ai-review-grid">
        <AnalysisField result={result} fieldKey="detected_brand" label="Merek terdeteksi" labelEn="Detected brand" selectable checked={Boolean(selected.detected_brand)} onChange={(checked) => onSelect((current) => ({ ...current, detected_brand: checked }))} />
        <AnalysisField result={result} fieldKey="suggested_title" label="Judul yang disarankan" labelEn="Suggested title" selectable checked={Boolean(selected.suggested_title)} onChange={(checked) => onSelect((current) => ({ ...current, suggested_title: checked }))} />
        <AnalysisField result={result} fieldKey="suggested_category" label="Kategori" labelEn="Category" selectable checked={Boolean(selected.suggested_category)} onChange={(checked) => onSelect((current) => ({ ...current, suggested_category: checked }))} />
        <AnalysisField result={result} fieldKey="color" label="Warna" labelEn="Color" />
      </div></section>

      <section className="ai-review-section"><h3>Kondisi <small>/ Condition</small></h3><div className="ai-review-grid">
        <AnalysisField result={result} fieldKey="condition_summary" label="Ringkasan kondisi" labelEn="Condition summary" selectable checked={Boolean(selected.condition_summary)} onChange={(checked) => onSelect((current) => ({ ...current, condition_summary: checked }))} />
        <AnalysisField result={result} fieldKey="visible_defects" label="Kekurangan terlihat" labelEn="Visible defects" selectable checked={Boolean(selected.visible_defects)} onChange={(checked) => onSelect((current) => ({ ...current, visible_defects: checked }))} />
      </div></section>

      <section className="ai-review-section"><h3>Era & gaya <small>/ Era & style</small></h3><div className="ai-review-grid">
        <AnalysisField result={result} fieldKey="estimated_era" label="Perkiraan era" labelEn="Estimated era" />
        <AnalysisField result={result} fieldKey="style" label="Gaya" labelEn="Style" />
      </div></section>

      <section className="ai-review-section"><h3>Rekomendasi marketplace <small>/ Marketplace recommendations</small></h3><div className="ai-marketplace-review">{recommendation.map((entry) => <article key={entry.marketplace}><b>{entry.marketplace}</b><span><strong>{entry.recommendation}</strong>{entry.recommendation_en && entry.recommendation_en !== entry.recommendation && <small>{entry.recommendation_en}</small>}{entry.listing_angle && <em>{entry.listing_angle}{entry.listing_angle_en && entry.listing_angle_en !== entry.listing_angle ? ` / ${entry.listing_angle_en}` : ''}</em>}</span></article>)}</div></section>

      <section className="ai-authenticity-note"><h3>Catatan keaslian <small>/ Authenticity note</small></h3><strong>{result.authenticity_note || 'Keaslian belum diverifikasi. Perlu pemeriksaan manual.'}</strong><span>{result.authenticity_note_en || 'Authenticity not verified. Manual verification required.'}</span></section>

      {notes.id && <section className="ai-review-section"><h3>Catatan untuk seller <small>/ Seller notes</small></h3><AnalysisField result={result} fieldKey="seller_notes" label="Catatan untuk seller" labelEn="Seller notes" selectable checked={Boolean(selected.seller_notes)} onChange={(checked) => onSelect((current) => ({ ...current, seller_notes: checked }))} /></section>}
      <p className="ai-confidence">Keyakinan AI / AI confidence: {Math.round(Number(result.confidence || 0))}%</p>
      <div className="seller-form-actions ai-analysis-actions"><button type="button" className="seller-primary" onClick={onApply} disabled={busy}>Terapkan Saran <small>Apply Suggestions</small></button><button type="button" className="seller-secondary" onClick={onRetry} disabled={busy}>Analisa Ulang <small>Retry</small></button><button type="button" className="seller-secondary" onClick={onCancel}>Batal <small>Cancel</small></button></div>
    </section>
  </div>
}

function AnalysisField({ result, fieldKey, label, labelEn, selectable = false, checked = false, onChange }) {
  const value = analysisBilingualValue(result, fieldKey)
  const hasValue = Boolean(value.id || value.en)
  return <div className={`ai-analysis-field ${selectable ? 'selectable' : ''}`}>
    {selectable && <input type="checkbox" aria-label={`Apply ${labelEn}`} checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={!hasValue} />}
    <span><b>{label}<small>/ {labelEn}</small></b><strong>{value.id || 'Belum ada saran'}</strong>{value.en && value.en !== value.id && <em>{value.en}</em>}{!value.id && <em>No suggestion available</em>}</span>
  </div>
}

function EditInventory({ id }) {
  const [form, setForm] = useState(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { async function load() { const { data, error } = await supabase.from('products').select('*').eq('id', id).single(); if (error) setMessage(errorText(error)); else setForm(data) }; load() }, [id])
  function set(key, value) { setForm((current) => ({ ...current, [key]: value })) }
  async function save(event) { event.preventDefault(); setBusy(true); const payload = { brand: form.brand, name: form.name, category: form.category || null, subcategory: form.subcategory || null, size_label: form.size_label || null, condition: form.condition || 'Good', condition_notes: form.condition_notes || null, defects: form.defects || null, purchase_price: Number(form.purchase_price || 0), suggested_price: Number(form.suggested_price || 0), minimum_price: Number(form.minimum_price || 0), price_idr: Number(form.suggested_price || 0), source: form.source || null, source_url: form.source_url ? safeHttpUrl(form.source_url) : null, purchase_date: form.purchase_date || null, description: form.description || null, status: form.status, is_published: Boolean(form.is_published), updated_at: new Date().toISOString() }; if (form.source_url && !payload.source_url) { setMessage('Source URL must use http:// or https://.'); setBusy(false); return }; const { error } = await supabase.from('products').update(payload).eq('id', id); if (error) setMessage(errorText(error)); else go(`/seller/inventory/${id}`); setBusy(false) }
  if (!form) return message ? <Notice tone="error">{message}</Notice> : <SellerLoading text="Loading item…" />
  return <div><a className="seller-back-link" href={`/seller/inventory/${id}`} onClick={(event) => { event.preventDefault(); go(`/seller/inventory/${id}`) }}>← Back to item</a><SellerHeader eyebrow={`${form.sku || 'SKU pending'} / EDIT`} title="Edit inventory" copy="Update the master record. SKU and existing photos are preserved." /><form className="seller-panel seller-form" onSubmit={save}><div className="seller-fields two"><Field label="Brand" value={form.brand || ''} onChange={(value) => set('brand', value)} required /><Field label="Item name" value={form.name || ''} onChange={(value) => set('name', value)} required /><Field label="Category" value={form.category || ''} onChange={(value) => set('category', value)} /><Field label="Subcategory" value={form.subcategory || ''} onChange={(value) => set('subcategory', value)} /><Field label="Size" value={form.size_label || ''} onChange={(value) => set('size_label', value)} /><Field label="Condition" value={form.condition || ''} onChange={(value) => set('condition', value)} /><Field label="Condition notes" value={form.condition_notes || ''} onChange={(value) => set('condition_notes', value)} /><Field label="Defects / minus" value={form.defects || ''} onChange={(value) => set('defects', value)} /><Field label="Purchase price" value={form.purchase_price || ''} onChange={(value) => set('purchase_price', value)} type="number" /><Field label="Suggested price" value={form.suggested_price || form.price_idr || ''} onChange={(value) => set('suggested_price', value)} type="number" /><Field label="Minimum price" value={form.minimum_price || ''} onChange={(value) => set('minimum_price', value)} type="number" /><Field label="Source" value={form.source || ''} onChange={(value) => set('source', value)} /><Field label="Source URL" value={form.source_url || ''} onChange={(value) => set('source_url', value)} /><Field label="Purchase date" value={form.purchase_date || ''} onChange={(value) => set('purchase_date', value)} type="date" /><label>Status<select value={form.status} onChange={(event) => set('status', event.target.value)}>{INVENTORY_STATUSES.map((status) => <option key={status} value={status}>{titleCaseStatus(status)}</option>)}</select></label><Field label="Description" value={form.description || ''} onChange={(value) => set('description', value)} textarea /></div><label className="check-field"><input type="checkbox" checked={Boolean(form.is_published)} onChange={(event) => set('is_published', event.target.checked)} /> Show on public storefront</label>{message && <Notice tone="error">{message}</Notice>}<div className="seller-form-actions"><button className="seller-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes →'}</button><button type="button" className="seller-secondary" onClick={() => go(`/seller/inventory/${id}`)}>Cancel</button></div></form></div>
}

function ListingRow({ listing, label, onEdit }) { return <div className="listing-row"><div><strong>{label}</strong><span>{listing.listing_url ? 'URL saved' : 'No listing URL'}</span></div><div><b className={`listing-status ${listing.listing_status.toLowerCase()}`}>{titleCaseStatus(listing.listing_status)}</b><small>{listing.listed_price ? moneyIdr(listing.listed_price) : '—'}</small></div><button type="button" onClick={onEdit}>Edit</button></div> }

function SourcingPage({ aiMode = false }) {
  const [items, setItems] = useState([]); const [showForm, setShowForm] = useState(false); const [message, setMessage] = useState(''); const [purchasePrices, setPurchasePrices] = useState({})
  const [form, setForm] = useState({ title: '', brand: '', category: '', source_platform: '', source_url: '', seller_asking_price: '', estimated_resale_min: '', estimated_resale_max: '', max_buy_price: '', condition: '', authenticity_risk: '', opportunity_score: '', notes: '', status: 'WATCHING' })
  async function load() { if (!supabase) return; const { data, error } = await supabase.from('sourcing_candidates').select('*').order('created_at', { ascending: false }); if (error) setMessage(errorText(error)); else setItems(data || []) }
  useEffect(() => { load() }, [])
  async function addCandidate(event) { event.preventDefault(); if (form.source_url && !safeHttpUrl(form.source_url)) { setMessage('Source URL must use http:// or https://.'); return }; const payload = { ...form, source_url: form.source_url ? safeHttpUrl(form.source_url) : null, seller_asking_price: Number(form.seller_asking_price || 0), estimated_resale_min: Number(form.estimated_resale_min || 0), estimated_resale_max: Number(form.estimated_resale_max || 0), max_buy_price: Number(form.max_buy_price || 0), opportunity_score: form.opportunity_score === '' ? null : Number(form.opportunity_score) }; const { error } = await supabase.from('sourcing_candidates').insert(payload); if (error) setMessage(errorText(error)); else { setShowForm(false); setForm({ ...form, title: '', brand: '', source_url: '', notes: '' }); load() } }
  async function updateStatus(candidate, status) { const now = new Date().toISOString(); const changes = { status }; if (status === 'CHECK' && !candidate.checked_at) changes.checked_at = now; if (status === 'BOUGHT' && !candidate.bought_at) changes.bought_at = now; const { error } = await supabase.from('sourcing_candidates').update(changes).eq('id', candidate.id); if (error) setMessage(errorText(error)); else load() }
  async function moveToInventory(candidate) { const purchasePrice = Number(purchasePrices[candidate.id] || candidate.seller_asking_price || 0); if (!purchasePrice) { setMessage('Enter the final buy price before moving this candidate.'); return }; const { data, error } = await supabase.rpc('convert_sourcing_to_inventory', { p_candidate_id: candidate.id, p_purchase_price: purchasePrice }); if (error) setMessage(errorText(error, 'Could not create inventory item.')); else { setMessage('Candidate moved to master inventory.'); load(); if (data) go(`/seller/inventory/${data}`) } }
  const visible = aiMode ? items.filter((item) => ['WATCHING', 'CHECK', 'NEGOTIATING'].includes(item.status)) : items
  return <div><SellerHeader eyebrow={aiMode ? 'HUNTING / RISET' : 'HUNTING / TEMUAN TERSIMPAN'} title={aiMode ? 'Riset' : 'Temuan tersimpan'} copy={aiMode ? 'A review queue for potential finds. Scores stay blank until a real AI or manual assessment exists.' : 'Save candidates before they become inventory. No external marketplace automation is used.'} action={<button className="seller-primary compact" type="button" onClick={() => setShowForm((value) => !value)}>＋ Tambah temuan</button>} />{message && <Notice tone="warning">{message}</Notice>}{!AI_ENABLED && aiMode && <Notice tone="info">AI belum dikonfigurasi. This queue is manual-only; no synthetic score is generated.</Notice>}{showForm && <form className="seller-panel seller-form sourcing-form" onSubmit={addCandidate}><PanelTitle eyebrow="NEW CANDIDATE" title="Watch an opportunity" /><div className="seller-fields two"><Field label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} required placeholder="Vintage Stussy jacket" /><Field label="Brand" value={form.brand} onChange={(value) => setForm({ ...form, brand: value })} placeholder="Stussy" /><Field label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} placeholder="Jackets" /><Field label="Source platform" value={form.source_platform} onChange={(value) => setForm({ ...form, source_platform: value })} placeholder="Grailed / Instagram" /><Field label="Source URL" value={form.source_url} onChange={(value) => setForm({ ...form, source_url: value })} placeholder="https://…" /><Field label="Seller asking price" value={form.seller_asking_price} onChange={(value) => setForm({ ...form, seller_asking_price: value })} type="number" /><Field label="Estimated resale min" value={form.estimated_resale_min} onChange={(value) => setForm({ ...form, estimated_resale_min: value })} type="number" /><Field label="Estimated resale max" value={form.estimated_resale_max} onChange={(value) => setForm({ ...form, estimated_resale_max: value })} type="number" /><Field label="Max buy price" value={form.max_buy_price} onChange={(value) => setForm({ ...form, max_buy_price: value })} type="number" /><Field label="Opportunity score (manual)" value={form.opportunity_score} onChange={(value) => setForm({ ...form, opportunity_score: value })} type="number" placeholder="0–100 or leave blank" /><Field label="Authenticity risk" value={form.authenticity_risk} onChange={(value) => setForm({ ...form, authenticity_risk: value })} placeholder="Unknown / low / high" /><Field label="Notes" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} textarea placeholder="What needs checking?" /></div><div className="seller-form-actions"><button className="seller-primary">Save candidate</button><button type="button" className="seller-secondary" onClick={() => setShowForm(false)}>Cancel</button></div></form>}<section className="sourcing-list">{visible.map((candidate) => <article className="sourcing-card" key={candidate.id}><div className="sourcing-card-head"><div><span className="sku">{candidate.source_platform || 'SOURCE UNKNOWN'}</span><h2>{candidate.title}</h2><p>{candidate.brand || 'Brand not set'} · asking {moneyIdr(candidate.seller_asking_price)}</p></div><b className={`opportunity ${candidate.opportunity_score >= 70 ? 'high' : candidate.opportunity_score >= 40 ? 'check' : candidate.opportunity_score == null ? 'empty' : 'skip'}`}>{candidate.opportunity_score == null ? 'NO SCORE' : candidate.opportunity_score >= 70 ? '🔥 HIGH POTENTIAL' : candidate.opportunity_score >= 40 ? '🟡 CHECK' : '🔴 SKIP'}</b></div><div className="sourcing-card-meta"><span>Max buy <strong>{moneyIdr(candidate.max_buy_price)}</strong></span><span>Resale <strong>{moneyIdr(candidate.estimated_resale_min)}–{moneyIdr(candidate.estimated_resale_max)}</strong></span><select value={candidate.status} onChange={(event) => updateStatus(candidate, event.target.value)}>{['WATCHING', 'CHECK', 'NEGOTIATING', 'BOUGHT', 'SKIPPED'].map((status) => <option key={status}>{status}</option>)}</select></div>{candidate.status === 'BOUGHT' && <div className="move-inventory"><input type="number" value={purchasePrices[candidate.id] || candidate.seller_asking_price || ''} onChange={(event) => setPurchasePrices({ ...purchasePrices, [candidate.id]: event.target.value })} placeholder="Final buy price" /><button type="button" className="seller-primary compact" onClick={() => moveToInventory(candidate)}>Move to inventory →</button></div>}</article>)}{!visible.length && <div className="seller-empty"><strong>NO CANDIDATES YET</strong><p>Use Add candidate to start the watchlist.</p></div>}</section></div>
}

function ListingsPage() {
  const [items, setItems] = useState([]); const [message, setMessage] = useState('')
  useEffect(() => { async function load() { if (!supabase) return; const { data, error } = await supabase.from('marketplace_listings').select('*, products(id,name,brand,sku,image_urls,status)').order('last_updated', { ascending: false }); if (error) setMessage(errorText(error)); else setItems(data || []) }; load() }, [])
  return <div><SellerHeader eyebrow="DISTRIBUTION STATUS" title="Listing" copy="Review marketplace copy and track where each master inventory item is listed. Posting and removal remain manual." />{message && <Notice tone="error">{message}</Notice>}<section className="seller-panel"><PanelTitle eyebrow="ALL CHANNELS" title="Marketplace listings" />{items.length ? <div className="listing-table">{items.map((listing) => { const safeUrl = safeHttpUrl(listing.listing_url); const productTitle = listing.listing_title || listing.products?.name || 'Unknown item'; return <article className="listing-row wide-row" key={listing.id}><img src={imageFor(listing.products)} alt="" loading="lazy" /><div className="listing-info"><span className="listing-sku">{listing.products?.sku || 'SKU pending'}</span><strong className="listing-title">{productTitle}</strong><span className="listing-marketplace">{titleCaseStatus(listing.marketplace)}</span><p className="listing-note">{listing.listing_description || (safeUrl ? 'Listing URL saved' : 'No URL saved')}</p><div className="listing-actions">{listing.products?.id && <a className="listing-action-link" href={`/seller/inventory/${listing.products.id}`} onClick={(event) => { event.preventDefault(); go(`/seller/inventory/${listing.products.id}`) }}>Buka barang <span aria-hidden="true">→</span></a>}{safeUrl && <a className="listing-action-link" href={safeUrl} target="_blank" rel="noreferrer">Buka listing <span aria-hidden="true">↗</span></a>}</div>{listing.products?.status === 'sold' && listing.listing_status === 'LISTED' && <em className="listing-active-warning">Item sold — check this external listing manually.</em>}</div><div className="listing-summary"><b className={`listing-status ${listing.listing_status.toLowerCase()}`}>{titleCaseStatus(listing.listing_status)}</b><small>{listing.listed_price ? moneyIdr(listing.listed_price) : '—'}</small></div></article> })}</div> : <div className="seller-empty"><strong>NO LISTINGS RECORDED</strong><p>Open an inventory item to update its marketplace status.</p></div>}</section></div>
}
function SalesPage() {
  const [sales, setSales] = useState([]); const [message, setMessage] = useState('')
  useEffect(() => { async function load() { if (!supabase) return; const { data, error } = await supabase.from('sales').select('*, products(name,brand,sku)').order('sold_at', { ascending: false }); if (error) setMessage(errorText(error)); else setSales(data || []) }; load() }, [])
  const totals = sales.reduce((acc, sale) => ({ revenue: acc.revenue + Number(sale.sale_price || 0), net: acc.net + Number(sale.net_profit || 0) }), { revenue: 0, net: 0 })
  return <div><SellerHeader eyebrow="REVENUE / PROFIT" title="Terjual" copy="Sales are recorded from the master inventory SOLD flow." />{message && <Notice tone="error">{message}</Notice>}<section className="seller-finance-grid"><Metric label="Recorded revenue" value={moneyIdr(totals.revenue)} /><Metric label="Recorded net profit" value={moneyIdr(totals.net)} /></section><section className="seller-panel"><PanelTitle eyebrow="SALES LEDGER" title={`${sales.length} recorded sales`} />{sales.length ? <div className="sales-list">{sales.map((sale) => <a className="sale-row" key={sale.id} href={`/seller/inventory/${sale.product_id}`} onClick={(event) => { event.preventDefault(); go(`/seller/inventory/${sale.product_id}`) }}><div><strong>{sale.products?.sku || 'SKU'} · {sale.products?.brand} {sale.products?.name}</strong><span>{titleCaseStatus(sale.sold_via)} · {dateLabel(sale.sold_at)}</span></div><div><b>{moneyIdr(sale.sale_price)}</b><small>Net {moneyIdr(sale.net_profit)}</small></div></a>)}</div> : <div className="seller-empty"><strong>NO SALES RECORDED</strong><p>Sold items will appear here.</p></div>}</section></div>
}

function AIUsagePage() {
  const [summary, setSummary] = useState(null); const [logs, setLogs] = useState([]); const [message, setMessage] = useState('')
  useEffect(() => { async function load() { if (!supabase) return; const [{ data: usage, error }, { data: records }] = await Promise.all([supabase.rpc('seller_ai_usage_summary'), supabase.from('ai_usage').select('*').order('created_at', { ascending: false }).limit(30)]); if (error) setMessage(errorText(error)); else setSummary(usage); setLogs(records || []) }; load() }, [])
  const tone = budgetTone(summary?.used || 0, summary?.budget || 0)
  return <div><SellerHeader eyebrow="AI FOUNDATION" title="Penggunaan AI" copy="Usage is tracked server-side. Inventory and seller operations continue when the AI budget is empty." />{message && <Notice tone="warning">{message}</Notice>}<section className="ai-budget-card"><div><span className="seller-kicker">MONTHLY BUDGET</span><strong>{moneyIdr(summary?.used || 0)} <small>/ {moneyIdr(summary?.budget || 100000)}</small></strong><p>{budgetLabel(summary?.used || 0, summary?.budget || 100000)}</p></div><div className={`big-budget-percent ${tone}`}>{Math.round(summary?.percentage || 0)}%</div></section>{!AI_ENABLED && <Notice tone="info">AI belum dikonfigurasi. Set VITE_AI_ENABLED=true only after deploying the server-side Supabase function with OPENAI_API_KEY.</Notice>}<section className="seller-panel"><PanelTitle eyebrow="RECENT EVENTS" title="Usage log" />{logs.length ? <div className="usage-list">{logs.map((log) => <div className="usage-row" key={log.id}><div><strong>{titleCaseStatus(log.feature)}</strong><span>{log.model || 'model unknown'} · {dateLabel(log.created_at)}</span></div><div><b>{moneyIdr(log.estimated_cost)}</b><small>{Number(log.input_tokens || 0) + Number(log.output_tokens || 0)} tokens</small></div></div>)}</div> : <div className="seller-empty"><strong>NO AI USAGE</strong><p>There are no server-side AI calls recorded this month.</p></div>}</section></div>
}

function SettingsPage() {
  const [budget, setBudget] = useState('100000'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { async function load() { if (!supabase) return; const { data } = await supabase.from('app_settings').select('value').eq('key', 'ai_monthly_budget').maybeSingle(); if (data?.value?.amount) setBudget(String(data.value.amount)) }; load() }, [])
  async function save(event) { event.preventDefault(); setBusy(true); const { error } = await supabase.from('app_settings').upsert({ key: 'ai_monthly_budget', value: { amount: Number(budget || 0), currency: 'IDR' }, updated_at: new Date().toISOString() }); setMessage(error ? errorText(error) : 'Monthly AI budget updated.'); setBusy(false) }
  return <div><SellerHeader eyebrow="ADMIN / CONFIGURATION" title="AI & Anggaran" copy="Small operational settings that affect seller workflows." /><form className="seller-panel settings-form" onSubmit={save}><PanelTitle eyebrow="AI GUARDRAIL" title="Monthly budget" /><p className="seller-muted">The server-side AI budget guard blocks paid calls when usage reaches this amount. Default: Rp100.000.</p><Field label="Monthly AI budget (IDR)" value={budget} onChange={setBudget} type="number" required /><div className="seller-form-actions"><button className="seller-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>{message && <Notice tone={message.includes('updated') ? 'success' : 'error'}>{message}</Notice>}</form><section className="seller-panel"><PanelTitle eyebrow="FUTURE INTEGRATIONS" title="Telegram contract" /><p className="seller-muted">The future endpoint is documented in <code>docs/SELLER_PANEL.md</code>. It will require authenticated server-to-server access and will create master inventory records before any downstream action.</p></section></div>
}

