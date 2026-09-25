import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  budgetLabel,
  budgetTone,
  calculateProfit,
  analysisSuggestionValue,
  applyItemAnalysisSuggestions,
  INVENTORY_STATUSES,
  ITEM_ANALYSIS_SUGGESTIONS,
  LISTING_STATUSES,
  MARKETPLACES,
  moneyIdr,
  safeHttpUrl,
  titleCaseStatus,
} from './seller-utils'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === 'true'
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null

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
  const [section, id, subSection] = path.replace(/^\/seller\/?/, '').split('/')
  let page = <SellerDashboard profile={profile} />
  if (section === 'inventory' && id === 'new') page = <NewInventory />
  else if (section === 'inventory' && id && subSection === 'edit') page = <EditInventory id={id} />
  else if (section === 'inventory' && id) page = <InventoryDetail id={id} />
  else if (section === 'inventory') page = <InventoryPage />
  else if (section === 'ai-hunter') page = <SourcingPage aiMode />
  else if (section === 'sourcing') page = <SourcingPage />
  else if (section === 'listings') page = <ListingsPage />
  else if (section === 'sales') page = <SalesPage />
  else if (section === 'ai-usage') page = <AIUsagePage />
  else if (section === 'settings') page = profile.role === 'ADMIN' ? <SettingsPage /> : <AccessDenied />
  return <main className="seller-app"><SellerSidebar path={path} profile={profile} onLogout={onLogout} /><section className="seller-content">{page}</section><SellerMobileNav path={path} profile={profile} onLogout={onLogout} /></main>
}

function SellerSidebar({ path, profile, onLogout }) {
  const links = [
    ['/seller', 'Dashboard', '⌂'],
    ['/seller/inventory', 'Inventory', '▣'],
    ['/seller/inventory/new', 'Add item', '+'],
    ['/seller/ai-hunter', 'AI Hunter', '✦'],
    ['/seller/sourcing', 'Sourcing', '◌'],
    ['/seller/listings', 'Listings', '↗'],
    ['/seller/sales', 'Sales', '◎'],
    ['/seller/ai-usage', 'AI Usage', '◒'],
  ]
  if (profile.role === 'ADMIN') links.push(['/seller/settings', 'Settings', '⚙'])
  return <aside className="seller-sidebar"><div className="seller-brand"><img src="/mascot-latest.png" alt="" /><div><strong>HAQLOOKS</strong><span>SELLER PANEL</span></div></div><nav>{links.map(([href, label, icon]) => <a key={href} href={href} className={(href === '/seller' ? path === href : path.startsWith(href)) ? 'active' : ''} onClick={(event) => { event.preventDefault(); go(href) }}><i>{icon}</i><span>{label}</span></a>)}</nav><div className="seller-user"><span className="role-pill">{profile.role}</span><small>{profile.email || 'Authenticated seller'}</small><button type="button" onClick={onLogout}>↪ Sign out</button></div></aside>
}

function SellerMobileNav({ path, profile, onLogout }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const primary = [['/seller', 'Home', '⌂'], ['/seller/inventory', 'Inventory', '▣'], ['/seller/inventory/new', 'Add', '+'], ['/seller/ai-hunter', 'Hunter', '✦']]
  const more = [['/seller/sourcing', 'Sourcing', '◌'], ['/seller/listings', 'Listings', '↗'], ['/seller/sales', 'Sales', '◎'], ['/seller/ai-usage', 'AI Usage', '◒']]
  if (profile.role === 'ADMIN') more.push(['/seller/settings', 'Settings', '⚙'])
  const isActive = (href) => href === '/seller' ? path === href : href === '/seller/inventory/new' ? path === href : href === '/seller/inventory' ? path.startsWith(href) && path !== '/seller/inventory/new' : path.startsWith(href)
  function navigate(href) { setMoreOpen(false); go(href) }
  return <>
    {moreOpen && <div className="seller-more-sheet" role="dialog" aria-label="More seller tools"><div className="seller-more-head"><strong>More tools</strong><button type="button" aria-label="Close more menu" onClick={() => setMoreOpen(false)}>×</button></div>{more.map(([href, label, icon]) => <a key={href} href={href} className={isActive(href) ? 'active' : ''} onClick={(event) => { event.preventDefault(); navigate(href) }}><i>{icon}</i><span>{label}</span></a>)}<button type="button" className="seller-more-logout" onClick={onLogout}>↪ Sign out</button></div>}
    <nav className="seller-mobile-nav" aria-label="Seller navigation">{primary.map(([href, label, icon]) => <a key={href} href={href} className={`${isActive(href) ? 'active' : ''} ${label === 'Add' ? 'add' : ''}`} onClick={(event) => { event.preventDefault(); navigate(href) }}><i>{icon}</i><span>{label}</span></a>)}<button type="button" className={moreOpen || more.some(([href]) => isActive(href)) ? 'active' : ''} onClick={() => setMoreOpen((value) => !value)}><i>•••</i><span>More</span></button></nav>
  </>
}

function SellerHeader({ eyebrow, title, copy, action }) {
  return <header className="seller-header"><div><span className="seller-kicker">{eyebrow}</span><h1>{title}</h1>{copy && <p>{copy}</p>}</div>{action}</header>
}

function SellerLoading({ text }) { return <main className="seller-loading"><span className="seller-spinner" /><p>{text}</p></main> }
function Notice({ children, tone = 'info' }) { return <div className={`seller-notice ${tone}`}>{children}</div> }
function AccessDenied() { return <div className="seller-empty"><strong>ADMIN ACCESS REQUIRED</strong><p>This area is limited to ADMIN accounts.</p></div> }

function SellerDashboard() {
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
  return <div><SellerHeader eyebrow="OPERATIONS / OVERVIEW" title="Good morning, seller." copy="Your master inventory is the source of truth for every channel." action={<a href="/seller/inventory/new" className="seller-primary compact" onClick={(event) => { event.preventDefault(); go('/seller/inventory/new') }}>＋ Add item</a>} />{message && <Notice tone="warning">{message}</Notice>}<section className="seller-stat-grid"><Stat label="Total stock" value={stats.total_stock} /><Stat label="Available" value={stats.available} tone="green" /><Stat label="Draft" value={stats.draft} tone="muted" /><Stat label="Reserved" value={stats.reserved} tone="yellow" /><Stat label="Sold" value={stats.sold} tone="red" /></section><section className="seller-finance-grid"><Metric label="Modal active" value={moneyIdr(stats.total_modal_active)} /><Metric label="Estimated stock value" value={moneyIdr(stats.estimated_stock_value)} /><Metric label="Revenue" value={moneyIdr(stats.revenue)} /><Metric label="Gross profit" value={moneyIdr(stats.gross_profit)} /><Metric label="Net profit" value={moneyIdr(stats.net_profit)} /></section><div className="seller-two-col"><section className="seller-panel"><PanelTitle eyebrow="AI BUDGET" title="Monthly usage" href="/seller/ai-usage" /><div className="budget-row"><strong>{moneyIdr(ai?.used || 0)}</strong><span>of {moneyIdr(ai?.budget || 100000)}</span></div><div className="budget-track"><span className={tone} style={{ width: `${Math.min(ai?.percentage || 0, 100)}%` }} /></div><div className="budget-foot"><span className={`budget-state ${tone}`}>{budgetLabel(ai?.used || 0, ai?.budget || 100000)}</span><span>{Math.round(ai?.percentage || 0)}%</span></div>{!AI_ENABLED && <p className="muted-note">AI belum dikonfigurasi. Usage stays at zero until the server-side function is enabled.</p>}</section><section className="seller-panel"><PanelTitle eyebrow="SOURCING WATCHLIST" title="Candidates to review" href="/seller/sourcing" />{watchlist.length ? watchlist.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} />) : <p className="seller-muted">No sourcing candidates yet.</p>}</section></div></div>
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
  return <div><SellerHeader eyebrow="MASTER DATABASE" title="Inventory" copy="One SKU, one source of truth. Keep every channel downstream from this list." action={<a href="/seller/inventory/new" className="seller-primary compact" onClick={(event) => { event.preventDefault(); go('/seller/inventory/new') }}>＋ Add item</a>} />{message && <Notice tone="error">{message}</Notice>}<section className="inventory-toolbar"><input value={filters.q} onChange={(event) => update('q', event.target.value)} placeholder="Search SKU, brand, title…" /><select value={filters.status} onChange={(event) => update('status', event.target.value)}><option value="">All status</option>{INVENTORY_STATUSES.map((status) => <option key={status} value={status}>{titleCaseStatus(status)}</option>)}</select><input value={filters.brand} onChange={(event) => update('brand', event.target.value)} placeholder="Brand filter" /><select value={filters.sort} onChange={(event) => update('sort', event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="capital">Highest capital</option></select></section><div className="inventory-count">{count} records · page {page + 1}</div><section className="inventory-list">{items.length ? items.map((item) => <InventoryCard key={item.id} item={item} />) : <div className="seller-empty"><strong>NO INVENTORY FOUND</strong><p>Add the first item or adjust your filters.</p></div>}</section><div className="pagination"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>← Previous</button><button type="button" disabled={(page + 1) * pageSize >= count} onClick={() => setPage((value) => value + 1)}>Next →</button></div></div>
}

function InventoryCard({ item }) { return <a href={`/seller/inventory/${item.id}`} className="inventory-card" onClick={(event) => { event.preventDefault(); go(`/seller/inventory/${item.id}`) }}><img src={imageFor(item)} alt="" /><div className="inventory-card-main"><div className="inventory-card-top"><span className="sku">{item.sku || 'SKU pending'}</span><span className={`inventory-status ${item.status}`}>{titleCaseStatus(item.status)}</span></div><h2>{item.brand} {item.name}</h2><p>{item.size_label || 'Size not set'} · {item.condition || 'Condition not set'}</p><div className="inventory-card-bottom"><strong>{moneyIdr(item.purchase_price)}</strong><span>Sell {moneyIdr(item.suggested_price || item.price_idr)}</span></div></div></a> }

function NewInventory() {
  const [form, setForm] = useState({ brand: '', name: '', category: '', subcategory: '', size_label: '', condition: 'Good', condition_notes: '', defects: '', purchase_price: '', suggested_price: '', minimum_price: '', source: '', source_url: '', purchase_date: today(), status: 'draft', description: '' })
  const [files, setFiles] = useState([]); const [previews, setPreviews] = useState([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  function set(key, value) { setForm((current) => ({ ...current, [key]: value })) }
  function chooseFiles(event) {
    const picked = [...event.target.files].slice(0, 10)
    setFiles(picked); setPreviews(picked.map((file) => URL.createObjectURL(file)))
    if (event.target.files.length > 10) setMessage('Only the first 10 images were selected.')
  }
  function removeFile(index) {
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))
    setPreviews((current) => { const next = current.filter((_, currentIndex) => currentIndex !== index); if (current[index]) URL.revokeObjectURL(current[index]); return next })
  }
  async function upload() {
    const urls = []
    for (const file of files) {
      if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) throw new Error('Each image must be an image file up to 8 MB.')
      const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `inventory/${crypto.randomUUID()}.${extension}`
      const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert: false, contentType: file.type })
      if (error) throw error
      urls.push(supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl)
    }
    return urls
  }
  async function save(event) {
    event.preventDefault(); setMessage('')
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
  return <div><SellerHeader eyebrow="MASTER DATABASE / NEW ITEM" title="Add item" copy="Capture the item in HAQLOOKS before analysing or distributing it." action={<button className="seller-secondary compact" type="button" onClick={() => go('/seller/inventory')}>Cancel</button>} />{message && <Notice tone="error">{message}</Notice>}<form className="seller-form" onSubmit={save}><section className="seller-panel"><PanelTitle eyebrow="01 / PHOTOS" title="Product photos" /><div className="photo-uploader"><div className="photo-preview-grid">{previews.length ? previews.map((src, index) => <div className="photo-preview" key={src}><img src={src} alt={`Preview ${index + 1}`} /><button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => removeFile(index)}>×</button></div>) : <div className="photo-empty"><strong>1–10 photos</strong><span>Clear, well-lit product images work best.</span></div>}</div><label className="upload-button"><input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" multiple onChange={chooseFiles} />＋ Choose photos</label></div></section><section className="seller-panel"><PanelTitle eyebrow="02 / IDENTITY" title="Basic information" /><div className="seller-fields two"><Field label="Brand" value={form.brand} onChange={(value) => set('brand', value)} required placeholder="Stussy" /><Field label="Item name" value={form.name} onChange={(value) => set('name', value)} required placeholder="Work Jacket" /><Field label="Category" value={form.category} onChange={(value) => set('category', value)} placeholder="Jackets" /><Field label="Subcategory" value={form.subcategory} onChange={(value) => set('subcategory', value)} placeholder="Workwear" /><Field label="Size" value={form.size_label} onChange={(value) => set('size_label', value)} placeholder="L / 42" /><Field label="Condition" value={form.condition} onChange={(value) => set('condition', value)} placeholder="Excellent" /><Field label="Condition notes" value={form.condition_notes} onChange={(value) => set('condition_notes', value)} placeholder="Light wear on cuff" /><Field label="Defects / minus" value={form.defects} onChange={(value) => set('defects', value)} placeholder="None" /></div></section><section className="seller-panel"><PanelTitle eyebrow="03 / MONEY" title="Capital & pricing" /><div className="seller-fields three"><Field label="Purchase price" value={form.purchase_price} onChange={(value) => set('purchase_price', value)} type="number" required placeholder="750000" /><Field label="Suggested price" value={form.suggested_price} onChange={(value) => set('suggested_price', value)} type="number" placeholder="2250000" /><Field label="Minimum price" value={form.minimum_price} onChange={(value) => set('minimum_price', value)} type="number" placeholder="1900000" /></div></section><section className="seller-panel"><PanelTitle eyebrow="04 / SOURCE" title="Where it came from" /><div className="seller-fields two"><Field label="Source" value={form.source} onChange={(value) => set('source', value)} placeholder="Hunting / seller name" /><Field label="Source URL" value={form.source_url} onChange={(value) => set('source_url', value)} placeholder="https://…" /><Field label="Purchase date" value={form.purchase_date} onChange={(value) => set('purchase_date', value)} type="date" /><label>Status<select value={form.status} onChange={(event) => set('status', event.target.value)}><option value="draft">Save as draft</option><option value="available">Save & available</option></select></label><Field label="Description" value={form.description} onChange={(value) => set('description', value)} textarea placeholder="The customer-facing story for this item…" /></div></section><div className="seller-form-actions"><button className="seller-primary" disabled={busy}>{busy ? 'SAVING…' : form.status === 'available' ? 'SAVE & AVAILABLE →' : 'SAVE AS DRAFT →'}</button><button type="button" className="seller-secondary" onClick={() => go('/seller/inventory')}>Cancel</button></div></form></div>
}

function Field({ label, value, onChange, type = 'text', placeholder, required = false, textarea = false, name }) { return <label>{label}{textarea ? <textarea name={name} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} placeholder={placeholder} rows="4" required={required} /> : <input name={name} type={type} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} placeholder={placeholder} required={required} />}</label> }

function InventoryDetail({ id }) {
  const [item, setItem] = useState(null); const [listings, setListings] = useState([]); const [sales, setSales] = useState([]); const [message, setMessage] = useState(''); const [editingListing, setEditingListing] = useState(null); const [showSold, setShowSold] = useState(false); const [analysis, setAnalysis] = useState(null); const [analysisBusy, setAnalysisBusy] = useState(false); const [analysisMessage, setAnalysisMessage] = useState(''); const [selectedSuggestions, setSelectedSuggestions] = useState({})
  async function load() {
    if (!supabase) return
    const [{ data: product, error }, { data: listingData }, { data: saleData }] = await Promise.all([
      supabase.from('products').select('*').eq('id', id).single(),
      supabase.from('marketplace_listings').select('*').eq('product_id', id).order('marketplace'),
      supabase.from('sales').select('*').eq('product_id', id).order('sold_at', { ascending: false }),
    ])
    if (error) setMessage(errorText(error, 'Inventory item not found.')); else { setItem(product); setListings(listingData || []); setSales(saleData || []) }
  }
  useEffect(() => { load() }, [id])
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
      setSelectedSuggestions(defaults); setAnalysis(data)
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
    else { setItem(data); setAnalysis(null); setAnalysisMessage('Selected suggestions applied. Review the item before saving further changes.') }
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
  if (!item) return message ? <div className="seller-empty"><strong>{message}</strong><button className="seller-secondary" onClick={() => go('/seller/inventory')}>Back to inventory</button></div> : <SellerLoading text="Loading item…" />
  const activeListings = listings.filter((listing) => ['LISTED', 'DRAFT'].includes(listing.listing_status) && listing.marketplace !== sales[0]?.sold_via)
  return <div><a className="seller-back-link" href="/seller/inventory" onClick={(event) => { event.preventDefault(); go('/seller/inventory') }}>← Back to inventory</a><SellerHeader eyebrow={`${item.sku || 'SKU pending'} / INVENTORY DETAIL`} title={`${item.brand} ${item.name}`} copy={`${item.size_label || 'Size not set'} · ${item.condition || 'Condition not set'} · added ${dateLabel(item.created_at)}`} action={<div className="seller-header-actions"><button type="button" className="seller-secondary compact seller-ai-button" onClick={analyzeItem} aria-disabled={!AI_ENABLED}>{analysisBusy ? 'ANALYZING…' : '✦ AI ANALYZE'}</button><a className="seller-secondary compact" href={`/seller/inventory/${id}/edit`} onClick={(event) => { event.preventDefault(); go(`/seller/inventory/${id}/edit`) }}>Edit item</a><span className={`inventory-status large ${item.status}`}>{titleCaseStatus(item.status)}</span></div>} />{message && <Notice tone={message.startsWith('Sold recorded') ? 'success' : 'warning'}>{message}</Notice>}{analysisMessage && <Notice tone="info">{analysisMessage}</Notice>}<div className="detail-grid"><section><div className="detail-hero"><img src={imageFor(item)} alt="" /><div><span>Purchase price</span><strong>{moneyIdr(item.purchase_price)}</strong><span>Suggested / minimum</span><b>{moneyIdr(item.suggested_price || item.price_idr)} / {moneyIdr(item.minimum_price)}</b></div></div><section className="seller-panel"><PanelTitle eyebrow="LISTING TRACKER" title="Marketplace status" /><div className="listing-stack">{MARKETPLACES.map((marketplace) => { const listing = listings.find((entry) => entry.marketplace === marketplace.key) || { marketplace: marketplace.key, listing_status: 'NOT_LISTED', listed_price: item.suggested_price || item.price_idr, listing_url: '' }; return <ListingRow key={marketplace.key} listing={listing} label={marketplace.label} onEdit={() => setEditingListing({ ...listing })} /> })}</div></section></section><aside className="detail-side"><section className="seller-panel"><PanelTitle eyebrow="MASTER DATA" title="Item facts" /><dl className="seller-dl"><div><dt>Category</dt><dd>{item.category || '—'}</dd></div><div><dt>Source</dt><dd>{item.source || '—'}</dd></div><div><dt>Purchase date</dt><dd>{dateLabel(item.purchase_date)}</dd></div><div><dt>Defects</dt><dd>{item.defects || 'None noted'}</dd></div></dl>{item.source_url && <a className="seller-text-link" href={item.source_url} target="_blank" rel="noreferrer">Open source URL ↗</a>}</section>{item.status !== 'sold' && <button className="seller-danger-button" type="button" onClick={() => setShowSold(true)}>MARK AS SOLD</button>}{item.status === 'sold' && <section className="seller-panel"><PanelTitle eyebrow="SALE" title="Profit recorded" />{sales[0] ? <div className="profit-box"><span>Sold via {titleCaseStatus(sales[0].sold_via)}</span><strong>{moneyIdr(sales[0].sale_price)}</strong><p>Gross {moneyIdr(sales[0].gross_profit)} · Net {moneyIdr(sales[0].net_profit)}</p></div> : <p className="seller-muted">Sale details unavailable.</p>}</section>}</aside></div>{item.status === 'sold' && activeListings.length > 0 && <Notice tone="warning">⚠ This item is still listed on: {activeListings.map((listing) => titleCaseStatus(listing.marketplace)).join(', ')}. Remove or update those listings manually.</Notice>}{editingListing && <div className="seller-modal-bg"><form className="seller-modal" onSubmit={saveListing}><div className="modal-head"><h2>{titleCaseStatus(editingListing.marketplace)} listing</h2><button type="button" onClick={() => setEditingListing(null)}>×</button></div><label>Status<select value={editingListing.listing_status} onChange={(event) => setEditingListing({ ...editingListing, listing_status: event.target.value })}>{LISTING_STATUSES.map((status) => <option key={status} value={status}>{titleCaseStatus(status)}</option>)}</select></label><label>Listed price<input type="number" value={editingListing.listed_price || ''} onChange={(event) => setEditingListing({ ...editingListing, listed_price: event.target.value })} /></label><label>Listing URL<input value={editingListing.listing_url || ''} onChange={(event) => setEditingListing({ ...editingListing, listing_url: event.target.value })} placeholder="https://…" /></label><div className="seller-form-actions"><button className="seller-primary">Save listing</button><button type="button" className="seller-secondary" onClick={() => setEditingListing(null)}>Cancel</button></div></form></div>}{analysis && <div className="seller-modal-bg ai-analysis-bg"><section className="seller-modal ai-analysis-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-analysis-title"><div className="modal-head"><div><span className="seller-kicker">ITEM ANALYSIS / REVIEW</span><h2 id="ai-analysis-title">Review AI suggestions</h2></div><button type="button" aria-label="Close analysis" onClick={() => setAnalysis(null)}>×</button></div><p className="seller-muted">AI suggestions never overwrite the item automatically. Review each field and apply only what you approve.</p><div className="ai-suggestion-list">{ITEM_ANALYSIS_SUGGESTIONS.map(({ key, label }) => { const value = analysisSuggestionValue(analysis.result, key); return <label className="ai-suggestion" key={key}><input type="checkbox" checked={Boolean(selectedSuggestions[key])} onChange={(event) => setSelectedSuggestions((current) => ({ ...current, [key]: event.target.checked }))} disabled={!value} /><span><b>{label}</b><strong>{value || 'No suggestion'}</strong></span></label> })}</div><section className="ai-marketplace-review"><span className="seller-kicker">MARKETPLACE NOTES</span>{(analysis.result.marketplace_recommendations || []).map((entry) => <div key={entry.marketplace}><b>{entry.marketplace}</b><span>{entry.recommendation}{entry.listing_angle ? ` · ${entry.listing_angle}` : ''}</span></div>)}</section><section className="ai-notes"><span className="seller-kicker">SELLER NOTES</span>{(analysis.result.seller_notes || []).map((note) => <span key={note}>• {note}</span>)}<small>Confidence: {Math.round(Number(analysis.result.confidence || 0))}%</small></section><div className="seller-form-actions ai-analysis-actions"><button type="button" className="seller-primary" onClick={applyAnalysis} disabled={analysisBusy}>APPLY SUGGESTIONS</button><button type="button" className="seller-secondary" onClick={analyzeItem} disabled={analysisBusy}>RETRY</button><button type="button" className="seller-secondary" onClick={() => setAnalysis(null)}>CANCEL</button></div></section></div>}{showSold && <div className="seller-modal-bg"><form className="seller-modal" onSubmit={markSold}><div className="modal-head"><h2>Mark as sold</h2><button type="button" onClick={() => setShowSold(false)}>×</button></div><p className="seller-muted">This updates master inventory and records the sale. External marketplace posts are not changed.</p><label>Sold via<select name="sold_via" defaultValue="HAQLOOKS">{MARKETPLACES.map((marketplace) => <option key={marketplace.key} value={marketplace.key}>{marketplace.label}</option>)}<option value="OTHER">Other</option></select></label><Field label="Sale price" name="sale_price" type="number" placeholder="2250000" required /><div className="seller-fields two"><Field label="Marketplace fee" name="marketplace_fee" type="number" placeholder="0" /><Field label="Payment fee" name="payment_fee" type="number" placeholder="0" /><Field label="Shipping subsidy" name="shipping_subsidy" type="number" placeholder="0" /><Field label="Other cost" name="other_cost" type="number" placeholder="0" /></div><label>Notes<textarea name="notes" rows="3" placeholder="Optional sale note" /></label><div className="seller-form-actions"><button className="seller-danger-button">Confirm sold</button><button type="button" className="seller-secondary" onClick={() => setShowSold(false)}>Cancel</button></div></form></div>}</div>
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
  async function updateStatus(candidate, status) { const { error } = await supabase.from('sourcing_candidates').update({ status }).eq('id', candidate.id); if (error) setMessage(errorText(error)); else load() }
  async function moveToInventory(candidate) { const purchasePrice = Number(purchasePrices[candidate.id] || candidate.seller_asking_price || 0); if (!purchasePrice) { setMessage('Enter the final buy price before moving this candidate.'); return }; const { data, error } = await supabase.rpc('convert_sourcing_to_inventory', { p_candidate_id: candidate.id, p_purchase_price: purchasePrice }); if (error) setMessage(errorText(error, 'Could not create inventory item.')); else { setMessage('Candidate moved to master inventory.'); load(); if (data) go(`/seller/inventory/${data}`) } }
  const visible = aiMode ? items.filter((item) => ['WATCHING', 'CHECK', 'NEGOTIATING'].includes(item.status)) : items
  return <div><SellerHeader eyebrow={aiMode ? 'AI FOUNDATION / HUNTER' : 'OPPORTUNITY PIPELINE'} title={aiMode ? 'AI Hunter' : 'Sourcing'} copy={aiMode ? 'A review queue for potential finds. Scores stay blank until a real AI or manual assessment exists.' : 'Save candidates before they become inventory. No external marketplace automation is used.'} action={<button className="seller-primary compact" type="button" onClick={() => setShowForm((value) => !value)}>＋ Add candidate</button>} />{message && <Notice tone="warning">{message}</Notice>}{!AI_ENABLED && aiMode && <Notice tone="info">AI belum dikonfigurasi. This queue is manual-only; no synthetic score is generated.</Notice>}{showForm && <form className="seller-panel seller-form sourcing-form" onSubmit={addCandidate}><PanelTitle eyebrow="NEW CANDIDATE" title="Watch an opportunity" /><div className="seller-fields two"><Field label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} required placeholder="Vintage Stussy jacket" /><Field label="Brand" value={form.brand} onChange={(value) => setForm({ ...form, brand: value })} placeholder="Stussy" /><Field label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} placeholder="Jackets" /><Field label="Source platform" value={form.source_platform} onChange={(value) => setForm({ ...form, source_platform: value })} placeholder="Grailed / Instagram" /><Field label="Source URL" value={form.source_url} onChange={(value) => setForm({ ...form, source_url: value })} placeholder="https://…" /><Field label="Seller asking price" value={form.seller_asking_price} onChange={(value) => setForm({ ...form, seller_asking_price: value })} type="number" /><Field label="Estimated resale min" value={form.estimated_resale_min} onChange={(value) => setForm({ ...form, estimated_resale_min: value })} type="number" /><Field label="Estimated resale max" value={form.estimated_resale_max} onChange={(value) => setForm({ ...form, estimated_resale_max: value })} type="number" /><Field label="Max buy price" value={form.max_buy_price} onChange={(value) => setForm({ ...form, max_buy_price: value })} type="number" /><Field label="Opportunity score (manual)" value={form.opportunity_score} onChange={(value) => setForm({ ...form, opportunity_score: value })} type="number" placeholder="0–100 or leave blank" /><Field label="Authenticity risk" value={form.authenticity_risk} onChange={(value) => setForm({ ...form, authenticity_risk: value })} placeholder="Unknown / low / high" /><Field label="Notes" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} textarea placeholder="What needs checking?" /></div><div className="seller-form-actions"><button className="seller-primary">Save candidate</button><button type="button" className="seller-secondary" onClick={() => setShowForm(false)}>Cancel</button></div></form>}<section className="sourcing-list">{visible.map((candidate) => <article className="sourcing-card" key={candidate.id}><div className="sourcing-card-head"><div><span className="sku">{candidate.source_platform || 'SOURCE UNKNOWN'}</span><h2>{candidate.title}</h2><p>{candidate.brand || 'Brand not set'} · asking {moneyIdr(candidate.seller_asking_price)}</p></div><b className={`opportunity ${candidate.opportunity_score >= 70 ? 'high' : candidate.opportunity_score >= 40 ? 'check' : candidate.opportunity_score == null ? 'empty' : 'skip'}`}>{candidate.opportunity_score == null ? 'NO SCORE' : candidate.opportunity_score >= 70 ? '🔥 HIGH POTENTIAL' : candidate.opportunity_score >= 40 ? '🟡 CHECK' : '🔴 SKIP'}</b></div><div className="sourcing-card-meta"><span>Max buy <strong>{moneyIdr(candidate.max_buy_price)}</strong></span><span>Resale <strong>{moneyIdr(candidate.estimated_resale_min)}–{moneyIdr(candidate.estimated_resale_max)}</strong></span><select value={candidate.status} onChange={(event) => updateStatus(candidate, event.target.value)}>{['WATCHING', 'CHECK', 'NEGOTIATING', 'BOUGHT', 'SKIPPED'].map((status) => <option key={status}>{status}</option>)}</select></div>{candidate.status === 'BOUGHT' && <div className="move-inventory"><input type="number" value={purchasePrices[candidate.id] || candidate.seller_asking_price || ''} onChange={(event) => setPurchasePrices({ ...purchasePrices, [candidate.id]: event.target.value })} placeholder="Final buy price" /><button type="button" className="seller-primary compact" onClick={() => moveToInventory(candidate)}>Move to inventory →</button></div>}</article>)}{!visible.length && <div className="seller-empty"><strong>NO CANDIDATES YET</strong><p>Use Add candidate to start the watchlist.</p></div>}</section></div>
}

function ListingsPage() {
  const [items, setItems] = useState([]); const [message, setMessage] = useState('')
  useEffect(() => { async function load() { if (!supabase) return; const { data, error } = await supabase.from('marketplace_listings').select('*, products(id,name,brand,sku,image_urls)').order('last_updated', { ascending: false }); if (error) setMessage(errorText(error)); else setItems(data || []) }; load() }, [])
  return <div><SellerHeader eyebrow="DISTRIBUTION STATUS" title="Listings" copy="Track where each master inventory item is listed. Posting and removal remain manual." />{message && <Notice tone="error">{message}</Notice>}<section className="seller-panel"><PanelTitle eyebrow="ALL CHANNELS" title="Marketplace listings" />{items.length ? <div className="listing-table">{items.map((listing) => <div className="listing-row wide-row" key={listing.id}><img src={imageFor(listing.products)} alt="" /><div><strong>{listing.products?.sku || 'SKU pending'} · {listing.products?.name || 'Unknown item'}</strong><span>{titleCaseStatus(listing.marketplace)} · {listing.listing_url || 'No URL saved'}</span></div><b className={`listing-status ${listing.listing_status.toLowerCase()}`}>{titleCaseStatus(listing.listing_status)}</b><small>{moneyIdr(listing.listed_price)}</small></div>)}</div> : <div className="seller-empty"><strong>NO LISTINGS RECORDED</strong><p>Open an inventory item to update its marketplace status.</p></div>}</section></div>
}

function SalesPage() {
  const [sales, setSales] = useState([]); const [message, setMessage] = useState('')
  useEffect(() => { async function load() { if (!supabase) return; const { data, error } = await supabase.from('sales').select('*, products(name,brand,sku)').order('sold_at', { ascending: false }); if (error) setMessage(errorText(error)); else setSales(data || []) }; load() }, [])
  const totals = sales.reduce((acc, sale) => ({ revenue: acc.revenue + Number(sale.sale_price || 0), net: acc.net + Number(sale.net_profit || 0) }), { revenue: 0, net: 0 })
  return <div><SellerHeader eyebrow="REVENUE / PROFIT" title="Sales" copy="Sales are recorded from the master inventory SOLD flow." />{message && <Notice tone="error">{message}</Notice>}<section className="seller-finance-grid"><Metric label="Recorded revenue" value={moneyIdr(totals.revenue)} /><Metric label="Recorded net profit" value={moneyIdr(totals.net)} /></section><section className="seller-panel"><PanelTitle eyebrow="SALES LEDGER" title={`${sales.length} recorded sales`} />{sales.length ? <div className="sales-list">{sales.map((sale) => <a className="sale-row" key={sale.id} href={`/seller/inventory/${sale.product_id}`} onClick={(event) => { event.preventDefault(); go(`/seller/inventory/${sale.product_id}`) }}><div><strong>{sale.products?.sku || 'SKU'} · {sale.products?.brand} {sale.products?.name}</strong><span>{titleCaseStatus(sale.sold_via)} · {dateLabel(sale.sold_at)}</span></div><div><b>{moneyIdr(sale.sale_price)}</b><small>Net {moneyIdr(sale.net_profit)}</small></div></a>)}</div> : <div className="seller-empty"><strong>NO SALES RECORDED</strong><p>Sold items will appear here.</p></div>}</section></div>
}

function AIUsagePage() {
  const [summary, setSummary] = useState(null); const [logs, setLogs] = useState([]); const [message, setMessage] = useState('')
  useEffect(() => { async function load() { if (!supabase) return; const [{ data: usage, error }, { data: records }] = await Promise.all([supabase.rpc('seller_ai_usage_summary'), supabase.from('ai_usage').select('*').order('created_at', { ascending: false }).limit(30)]); if (error) setMessage(errorText(error)); else setSummary(usage); setLogs(records || []) }; load() }, [])
  const tone = budgetTone(summary?.used || 0, summary?.budget || 0)
  return <div><SellerHeader eyebrow="AI FOUNDATION" title="AI Usage" copy="Usage is tracked server-side. Inventory and seller operations continue when the AI budget is empty." />{message && <Notice tone="warning">{message}</Notice>}<section className="ai-budget-card"><div><span className="seller-kicker">MONTHLY BUDGET</span><strong>{moneyIdr(summary?.used || 0)} <small>/ {moneyIdr(summary?.budget || 100000)}</small></strong><p>{budgetLabel(summary?.used || 0, summary?.budget || 100000)}</p></div><div className={`big-budget-percent ${tone}`}>{Math.round(summary?.percentage || 0)}%</div></section>{!AI_ENABLED && <Notice tone="info">AI belum dikonfigurasi. Set VITE_AI_ENABLED=true only after deploying the server-side Supabase function with OPENAI_API_KEY.</Notice>}<section className="seller-panel"><PanelTitle eyebrow="RECENT EVENTS" title="Usage log" />{logs.length ? <div className="usage-list">{logs.map((log) => <div className="usage-row" key={log.id}><div><strong>{titleCaseStatus(log.feature)}</strong><span>{log.model || 'model unknown'} · {dateLabel(log.created_at)}</span></div><div><b>{moneyIdr(log.estimated_cost)}</b><small>{Number(log.input_tokens || 0) + Number(log.output_tokens || 0)} tokens</small></div></div>)}</div> : <div className="seller-empty"><strong>NO AI USAGE</strong><p>There are no server-side AI calls recorded this month.</p></div>}</section></div>
}

function SettingsPage() {
  const [budget, setBudget] = useState('100000'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { async function load() { if (!supabase) return; const { data } = await supabase.from('app_settings').select('value').eq('key', 'ai_monthly_budget').maybeSingle(); if (data?.value?.amount) setBudget(String(data.value.amount)) }; load() }, [])
  async function save(event) { event.preventDefault(); setBusy(true); const { error } = await supabase.from('app_settings').upsert({ key: 'ai_monthly_budget', value: { amount: Number(budget || 0), currency: 'IDR' }, updated_at: new Date().toISOString() }); setMessage(error ? errorText(error) : 'Monthly AI budget updated.'); setBusy(false) }
  return <div><SellerHeader eyebrow="ADMIN / CONFIGURATION" title="Settings" copy="Small operational settings that affect seller workflows." /><form className="seller-panel settings-form" onSubmit={save}><PanelTitle eyebrow="AI GUARDRAIL" title="Monthly budget" /><p className="seller-muted">The server-side AI budget guard blocks paid calls when usage reaches this amount. Default: Rp100.000.</p><Field label="Monthly AI budget (IDR)" value={budget} onChange={setBudget} type="number" required /><div className="seller-form-actions"><button className="seller-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>{message && <Notice tone={message.includes('updated') ? 'success' : 'error'}>{message}</Notice>}</form><section className="seller-panel"><PanelTitle eyebrow="FUTURE INTEGRATIONS" title="Telegram contract" /><p className="seller-muted">The future endpoint is documented in <code>docs/SELLER_PANEL.md</code>. It will require authenticated server-to-server access and will create master inventory records before any downstream action.</p></section></div>
}
