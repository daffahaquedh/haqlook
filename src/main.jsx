import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import './styles.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const WHATSAPP = import.meta.env.VITE_WHATSAPP_NUMBER || ''
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null

const fallbackProducts = [
  { id:'sample-1', slug:'p6000-silver-red', name:'P-6000 Silver / Red', brand:'Nike', model:'P-6000', price_idr:1299000, price_usd:79, size_label:'EU 42 / US 8.5', condition:'Excellent', description:'Curated pre-owned runner with metallic silver panels and red accents. Clean upper, fresh midsole, and ready for daily rotation.', status:'available', featured:true, is_published:true, image_urls:[], created_at:'2026-09-16T10:00:00Z' },
  { id:'sample-2', slug:'p6000-blue-grey', name:'P-6000 Blue / Grey', brand:'Nike', model:'P-6000', price_idr:1199000, price_usd:73, size_label:'EU 41 / US 8', condition:'Good', description:'Grey mesh runner with blue accents. Carefully selected and photographed so buyers can inspect condition before ordering.', status:'reserved', featured:true, is_published:true, image_urls:[], created_at:'2026-09-15T10:00:00Z' },
  { id:'sample-3', slug:'p6000-electric-blue', name:'P-6000 Electric Blue', brand:'Nike', model:'P-6000', price_idr:1349000, price_usd:82, size_label:'EU 43 / US 9.5', condition:'Excellent', description:'Bold electric blue colorway with silver overlays. Strong statement pair for technical runner and Y2K styling.', status:'available', featured:false, is_published:true, image_urls:[], created_at:'2026-09-14T10:00:00Z' },
  { id:'sample-4', slug:'runner-orange-black', name:'Runner Orange / Black', brand:'Nike', model:'P-6000', price_idr:999000, price_usd:61, size_label:'EU 42.5 / US 9', condition:'Good', description:'Orange and black pre-owned runner from the HAQLOOK archive. Sold pairs stay visible as part of the store history.', status:'sold', featured:false, is_published:true, image_urls:[], created_at:'2026-09-12T10:00:00Z' },
]

function money(value){ return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value||0)) }
function slugify(v=''){ return v.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') }
function route(){ return window.location.pathname || '/' }
function navigate(path){ window.history.pushState({},'',path); window.dispatchEvent(new PopStateEvent('popstate')) }
function initials(name='HAQLOOK'){ return name.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase() }

function App(){
  const [path,setPath]=useState(route())
  const [products,setProducts]=useState(fallbackProducts)
  const [loading,setLoading]=useState(true)

  useEffect(()=>{ const fn=()=>setPath(route()); addEventListener('popstate',fn); return()=>removeEventListener('popstate',fn) },[])
  useEffect(()=>{ loadPublicProducts() },[])

  async function loadPublicProducts(){
    setLoading(true)
    if(!supabase){ setProducts(fallbackProducts); setLoading(false); return }
    const {data,error}=await supabase.from('products').select('*').eq('is_published',true).order('created_at',{ascending:false})
    if(!error && data?.length) setProducts(data)
    else setProducts(fallbackProducts)
    setLoading(false)
  }

  let page
  if(path==='/') page=<Home products={products} />
  else if(path==='/shop') page=<Shop products={products} loading={loading} />
  else if(path==='/archive') page=<Archive products={products} />
  else if(path==='/about') page=<About />
  else if(path==='/shipping') page=<Shipping />
  else if(path==='/admin/login') page=<AdminLogin />
  else if(path==='/admin') page=<AdminDashboard />
  else if(path.startsWith('/product/')) page=<ProductDetail product={products.find(p=>p.slug===decodeURIComponent(path.split('/').pop()))} />
  else page=<NotFound />

  return <><Nav path={path}/>{page}<Footer/></>
}

function Link({to,children,className=''}){ return <a href={to} className={className} onClick={e=>{ if(!e.metaKey&&!e.ctrlKey){e.preventDefault();navigate(to)} }}>{children}</a> }

function Nav({path}){
  const [open,setOpen]=useState(false)
  const links=[['/shop','SHOP'],['/archive','ARCHIVE'],['/about','ABOUT'],['/shipping','SHIPPING']]
  return <header className="nav"><div className="shell nav-inner">
    <Link to="/" className="brand"><span className="brand-badge">H</span><span>HAQLOOK</span></Link>
    <nav className={open?'nav-links open':'nav-links'}>
      {links.map(([href,label])=><Link key={href} to={href} className={path===href?'active':''}>{label}</Link>)}
      <a href="https://www.instagram.com/haqlook/" target="_blank" rel="noreferrer">INSTAGRAM ↗</a>
    </nav>
    <button className="menu" onClick={()=>setOpen(v=>!v)}>{open?'CLOSE':'MENU'}</button>
  </div></header>
}

function Home({products}){
  const latest=products.filter(p=>p.status!=='sold').slice(0,4)
  return <main>
    <section className="hero"><div className="shell hero-grid">
      <div className="hero-copy"><p className="eyebrow orange">CURATED IN INDONESIA · SHIPPED WORLDWIDE</p><h1>PRE-OWNED.<br/><span>HANDPICKED.</span><br/>READY TO MOVE.</h1><p className="lead">Unique sneakers with real condition notes, detailed photos, and one-pair stock. Built for collectors, runners, and people who want something different.</p><div className="actions"><Link to="/shop" className="btn primary">SHOP NEW ARRIVALS</Link><Link to="/archive" className="btn outline">VIEW ARCHIVE</Link></div></div>
      <div className="mascot"><div className="orbit one"></div><div className="orbit two"></div><div className="cat"><div className="ear left"></div><div className="ear right"></div><span>H</span></div><b className="tag t1">ONE PAIR</b><b className="tag t2">ONE STORY</b><b className="tag t3">WORLDWIDE ↗</b></div>
    </div></section>
    <div className="ticker">HAQLOOK · PRE-OWNED SNEAKERS · WORLDWIDE SHIPPING · ONE PAIR ONE STORY · HAQLOOK · PRE-OWNED SNEAKERS · WORLDWIDE SHIPPING ·</div>
    <section className="shell section"><div className="section-head"><div><p className="eyebrow">LATEST DROP</p><h2>Fresh pairs, one stock each.</h2></div><Link to="/shop" className="textlink">VIEW ALL →</Link></div><div className="grid">{latest.map(p=><Card key={p.id} p={p}/>)}</div></section>
    <section className="manifesto"><div className="shell manifesto-grid"><span className="orange">01</span><div><p className="eyebrow orange">WHY HAQLOOK</p><h2>Not mass stock. Every pair has its own character.</h2></div><div><p>Sold pairs stay visible in the archive, turning HAQLOOK into a living catalog instead of a storefront that forgets its history.</p><Link to="/about" className="textlink">OUR STORY →</Link></div></div></section>
  </main>
}

function Card({p}){
  const img=p.image_urls?.[0]
  return <article className="card"><Link to={`/product/${p.slug}`} className="visual">{img?<img src={img} alt={p.name}/>:<FallbackVisual p={p}/>}<Status s={p.status}/></Link><div className="card-body"><p className="eyebrow">{p.brand}</p><h3><Link to={`/product/${p.slug}`}>{p.name}</Link></h3><div className="card-meta"><span>{p.size_label||'ASK SIZE'}</span><strong>{money(p.price_idr)}</strong></div></div></article>
}
function FallbackVisual({p}){ return <div className={`fallback fallback-${p.id?.slice(-1)||'x'}`}><span className="shoe-word">{p.model||p.brand}</span><b>{initials(p.name)}</b><small>CURATED / PRE-OWNED</small></div> }
function Status({s}){ return <span className={`status ${s}`}>{String(s).toUpperCase()}</span> }

function Shop({products,loading}){
  const [q,setQ]=useState(''); const [st,setSt]=useState('all')
  const filtered=useMemo(()=>products.filter(p=>(`${p.name} ${p.brand} ${p.model||''} ${p.size_label||''}`.toLowerCase().includes(q.toLowerCase()))&&(st==='all'||p.status===st)),[products,q,st])
  return <PageIntro eyebrow="HAQLOOK STORE" title="ALL PAIRS" copy="Curated pre-owned sneakers. One listing usually means one actual pair."><div className="filters"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search model, brand, size..."/><select value={st} onChange={e=>setSt(e.target.value)}><option value="all">All status</option><option value="available">Available</option><option value="reserved">Reserved</option><option value="sold">Sold</option></select></div>{loading?<Empty text="LOADING DROP..."/>:<div className="grid">{filtered.map(p=><Card p={p} key={p.id}/>)}</div>}</PageIntro>
}
function Archive({products}){ const sold=products.filter(p=>p.status==='sold'); return <PageIntro eyebrow="HAQLOOK HISTORY" title="SOLD ARCHIVE" copy="Pairs that found a new owner stay here. The archive is part catalog, part history.">{sold.length?<div className="grid">{sold.map(p=><Card p={p} key={p.id}/>)}</div>:<Empty text="ARCHIVE IS WAITING FOR ITS FIRST SOLD PAIR."/>}</PageIntro> }
function About(){ return <PageIntro eyebrow="ABOUT HAQLOOK" title={<>ONE PAIR.<br/>ONE STORY.</>} copy="HAQLOOK is a curated pre-owned sneaker store from Indonesia. We find interesting pairs, document them clearly, and connect them with the next owner."><div className="editorial">{[['01','Curated, not crowded.','Every listing can be a different size, condition, colorway, and story.'],['02','Photos over promises.','Pre-owned shopping works best when buyers can inspect the pair before ordering.'],['03','Indonesia to anywhere.','Built for local and international buyers with worldwide shipping quotes.']].map(x=><article key={x[0]}><span>{x[0]}</span><h2>{x[1]}</h2><p>{x[2]}</p></article>)}</div></PageIntro> }
function Shipping(){ return <PageIntro eyebrow="SHIPS FROM INDONESIA" title="WORLDWIDE SHIPPING" copy="International shipping is quoted per destination, pair size, and courier availability."><div className="editorial shipping">{[['01','Choose a pair','Check size, condition, status, and photos.'],['02','Message HAQLOOK','Send the product plus destination country and postal code.'],['03','Get a quote','Shipping is confirmed before payment.'],['04','Pack & ship','Your pair is packed and shipped from Indonesia.']].map(x=><article key={x[0]}><span>{x[0]}</span><h2>{x[1]}</h2><p>{x[2]}</p></article>)}</div><div className="notice">Import taxes, customs fees, and local duties may be charged by the destination country and are the buyer’s responsibility.</div></PageIntro> }

function PageIntro({eyebrow,title,copy,children}){ return <main className="page"><section className="shell intro"><p className="eyebrow orange">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></section><section className="shell section">{children}</section></main> }
function Empty({text}){ return <div className="empty"><b>{text}</b></div> }

function ProductDetail({product}){
  if(!product) return <NotFound/>
  const imgs=product.image_urls||[]
  const msg=encodeURIComponent(`Hi HAQLOOK, I'm interested in ${product.name} (${product.slug}). Is it still available?`)
  const wa=WHATSAPP?`https://wa.me/${WHATSAPP}?text=${msg}`:`https://www.instagram.com/haqlook/`
  return <main className="page"><section className="shell detail"><div className="gallery">{imgs.length?imgs.map((u,i)=><div className="photo" key={u+i}><img src={u} alt={`${product.name} ${i+1}`}/></div>):<div className="photo big"><FallbackVisual p={product}/></div>}</div><aside className="summary"><p className="eyebrow">{product.brand}</p><h1>{product.name}</h1><div className="summary-status"><Status s={product.status}/><span>{product.condition}</span></div><div className="price">{money(product.price_idr)}</div>{product.price_usd?<small>≈ US${product.price_usd}</small>:null}<dl><div><dt>Model</dt><dd>{product.model||'—'}</dd></div><div><dt>Size</dt><dd>{product.size_label||'Ask us'}</dd></div><div><dt>Condition</dt><dd>{product.condition}</dd></div><div><dt>Ships from</dt><dd>Indonesia</dd></div></dl><p className="desc">{product.description||'Please review all photos carefully for condition and details.'}</p>{product.status==='available'?<a className="btn primary wide" href={wa} target="_blank" rel="noreferrer">ASK / BUY NOW</a>:<button className="btn disabled wide" disabled>{product.status==='sold'?'SOLD — ARCHIVED':'CURRENTLY RESERVED'}</button>}<a className="btn outline wide" href="https://www.instagram.com/haqlook/" target="_blank" rel="noreferrer">MESSAGE ON INSTAGRAM ↗</a><Link to="/shop" className="textlink back">← BACK TO SHOP</Link></aside></section></main>
}

function AdminLogin(){
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [msg,setMsg]=useState(''); const [busy,setBusy]=useState(false)
  async function submit(e){ e.preventDefault(); if(!supabase){setMsg('Supabase environment variables are not configured yet.');return} setBusy(true);setMsg(''); const {data,error}=await supabase.auth.signInWithPassword({email,password}); if(error){setMsg(error.message);setBusy(false);return} const {data:admin,error:aerr}=await supabase.from('admins').select('user_id').eq('user_id',data.user.id).maybeSingle(); if(aerr||!admin){await supabase.auth.signOut();setMsg('This account is not registered as a HAQLOOK admin.');setBusy(false);return} navigate('/admin') }
  return <main className="login-wrap"><div className="login-card"><div className="brand"><span className="brand-badge">H</span><span>HAQLOOK</span></div><p className="eyebrow orange">ADMIN ACCESS</p><h1>Manage the drop.</h1><form onSubmit={submit}><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{msg&&<div className="error">{msg}</div>}<button className="btn primary wide" disabled={busy}>{busy?'SIGNING IN...':'SIGN IN'}</button></form></div></main>
}

function AdminDashboard(){
  const [ready,setReady]=useState(false),[items,setItems]=useState([]),[msg,setMsg]=useState('Checking admin access...'),[editing,setEditing]=useState(null)
  useEffect(()=>{guard()},[])
  async function guard(){ if(!supabase){setMsg('Supabase environment variables are missing.');return} const {data:{user}}=await supabase.auth.getUser(); if(!user){navigate('/admin/login');return} const {data}=await supabase.from('admins').select('user_id').eq('user_id',user.id).maybeSingle(); if(!data){await supabase.auth.signOut();navigate('/admin/login');return} setReady(true);load() }
  async function load(){ const {data,error}=await supabase.from('products').select('*').order('created_at',{ascending:false}); if(error)setMsg(error.message); else {setItems(data||[]);setMsg('')} }
  async function logout(){await supabase.auth.signOut();navigate('/admin/login')}
  async function remove(p){ if(!confirm(`Delete ${p.name}?`))return; const {error}=await supabase.from('products').delete().eq('id',p.id); if(error)setMsg(error.message); else load() }
  if(!ready)return <main className="admin-shell"><Empty text={msg}/></main>
  const stats={all:items.length,available:items.filter(x=>x.status==='available').length,reserved:items.filter(x=>x.status==='reserved').length,sold:items.filter(x=>x.status==='sold').length}
  return <main className="admin-shell"><div className="admin-head"><div><p className="eyebrow orange">HAQLOOK ADMIN</p><h1>Product dashboard</h1></div><div className="actions"><button className="btn primary" onClick={()=>setEditing({})}>+ ADD PRODUCT</button><button className="btn outline" onClick={logout}>SIGN OUT</button></div></div><div className="stats">{Object.entries(stats).map(([k,v])=><div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>{msg&&<div className="error">{msg}</div>}<div className="panel"><div className="panel-head"><h2>Products</h2><button className="textlink fake" onClick={load}>REFRESH ↻</button></div>{!items.length?<Empty text="NO DATABASE PRODUCTS YET."/>:<div className="table-wrap"><table><thead><tr><th>Product</th><th>Status</th><th>Size</th><th>Price</th><th>Published</th><th></th></tr></thead><tbody>{items.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small>{p.brand} · {p.slug}</small></td><td><Status s={p.status}/></td><td>{p.size_label||'—'}</td><td>{money(p.price_idr)}</td><td>{p.is_published?'YES':'NO'}</td><td><button className="mini" onClick={()=>setEditing(p)}>EDIT</button><button className="mini danger" onClick={()=>remove(p)}>DELETE</button></td></tr>)}</tbody></table></div>}</div>{editing!==null&&<ProductModal product={editing.id?editing:null} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);load()}}/>}</main>
}

function ProductModal({product,onClose,onSaved}){
  const [f,setF]=useState({name:product?.name||'',slug:product?.slug||'',brand:product?.brand||'',model:product?.model||'',price_idr:product?.price_idr||'',price_usd:product?.price_usd||'',size_label:product?.size_label||'',condition:product?.condition||'Good',description:product?.description||'',status:product?.status||'available',featured:product?.featured||false,is_published:product?.is_published??true,image_urls:product?.image_urls||[]})
  const [files,setFiles]=useState([]),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false)
  const set=(k,v)=>setF(x=>({...x,[k]:v}))
  async function upload(){const urls=[];for(const file of files){const ext=file.name.split('.').pop();const path=`${crypto.randomUUID()}.${ext}`;const {error}=await supabase.storage.from('product-images').upload(path,file);if(error)throw error;const {data}=supabase.storage.from('product-images').getPublicUrl(path);urls.push(data.publicUrl)}return urls}
  async function save(e){e.preventDefault();setBusy(true);setMsg('');try{const uploaded=await upload();const payload={...f,slug:f.slug||slugify(f.name),price_idr:Number(f.price_idr||0),price_usd:f.price_usd?Number(f.price_usd):null,model:f.model||null,size_label:f.size_label||null,description:f.description||null,image_urls:[...f.image_urls,...uploaded]};const q=product?supabase.from('products').update(payload).eq('id',product.id):supabase.from('products').insert(payload);const {error}=await q;if(error)throw error;onSaved()}catch(err){setMsg(err.message||'Save failed')}setBusy(false)}
  return <div className="modal-bg" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal"><div className="modal-head"><h2>{product?'Edit product':'Add product'}</h2><button onClick={onClose}>×</button></div><form onSubmit={save} className="form-grid"><label>Name<input value={f.name} onChange={e=>{set('name',e.target.value);if(!product&&!f.slug)set('slug',slugify(e.target.value))}} required/></label><label>Slug<input value={f.slug} onChange={e=>set('slug',slugify(e.target.value))} required/></label><label>Brand<input value={f.brand} onChange={e=>set('brand',e.target.value)} required/></label><label>Model<input value={f.model} onChange={e=>set('model',e.target.value)}/></label><label>Price IDR<input type="number" value={f.price_idr} onChange={e=>set('price_idr',e.target.value)} required/></label><label>Price USD<input type="number" value={f.price_usd} onChange={e=>set('price_usd',e.target.value)}/></label><label>Size<input value={f.size_label} onChange={e=>set('size_label',e.target.value)} placeholder="EU 42 / US 8.5"/></label><label>Condition<input value={f.condition} onChange={e=>set('condition',e.target.value)}/></label><label>Status<select value={f.status} onChange={e=>set('status',e.target.value)}><option value="available">Available</option><option value="reserved">Reserved</option><option value="sold">Sold</option></select></label><label className="full">Description<textarea rows="5" value={f.description} onChange={e=>set('description',e.target.value)}/></label><label className="full">Upload photos<input type="file" accept="image/*" multiple onChange={e=>setFiles([...e.target.files])}/></label><label className="check"><input type="checkbox" checked={f.featured} onChange={e=>set('featured',e.target.checked)}/> Featured</label><label className="check"><input type="checkbox" checked={f.is_published} onChange={e=>set('is_published',e.target.checked)}/> Published</label>{msg&&<div className="error full">{msg}</div>}<div className="actions full"><button className="btn primary" disabled={busy}>{busy?'SAVING...':'SAVE PRODUCT'}</button><button type="button" className="btn outline" onClick={onClose}>CANCEL</button></div></form></div></div>
}

function NotFound(){return <main className="login-wrap"><div className="empty"><b>404 — PAGE NOT FOUND</b><br/><br/><Link to="/" className="textlink">BACK HOME →</Link></div></main>}
function Footer(){return <footer><div className="shell footer-grid"><div><div className="brand"><span className="brand-badge">H</span><span>HAQLOOK</span></div><p>Curated pre-owned sneakers from Indonesia. One pair, one story.</p></div><div><Link to="/shop">Shop</Link><Link to="/archive">Archive</Link><Link to="/shipping">Worldwide Shipping</Link><Link to="/admin/login">Admin</Link></div><div><span>INDONESIA → WORLDWIDE</span><span>© 2026 HAQLOOK</span></div></div></footer>}

createRoot(document.getElementById('root')).render(<App />)
