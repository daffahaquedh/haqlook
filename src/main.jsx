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
function initials(name='HAQLOOKS'){ return name.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase() }

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

function Link({to,children,className=''}){
  return <a href={to} className={className} onClick={e=>{ if(!e.metaKey&&!e.ctrlKey){e.preventDefault();navigate(to)} }}>{children}</a>
}

function SearchIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>}
function UserIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.9-4 3.2-6 7-6s6.1 2 7 6"/></svg>}
function BagIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg>}
function CheckIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>}
function BoxIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>}
function GlobeIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z"/></svg>}
function ShieldIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.6-2.4 8-7 10-4.6-2-7-5.4-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>}
function LeafIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4C10 4 5 9 5 16c4 0 10-1 14-12Z"/><path d="M5 20c2-5 5-8 10-11"/></svg>}

function Nav({path}){
  const [open,setOpen]=useState(false)
  const links=[['/','Home'],['/shop','Shop'],['/about','About'],['/shipping','Shipping']]
  return <header className="nav"><div className="shell nav-inner">
    <Link to="/" className="brand-wordmark">HAQLOOKS</Link>
    <nav className={open?'nav-links open':'nav-links'}>
      {links.map(([href,label])=>{
        const active=href==='/'?path==='/':path.startsWith(href)
        return <Link key={href} to={href} className={active?'active':''}>{label}</Link>
      })}
      <a href="#contact" onClick={()=>setOpen(false)}>Contact</a>
    </nav>
    <div className="nav-tools">
      <Link to="/shop" className="icon-btn" aria-label="Search"><SearchIcon/></Link>
      <Link to="/admin/login" className="icon-btn" aria-label="Account"><UserIcon/></Link>
      <Link to="/shop" className="icon-btn bag-btn" aria-label="Shop"><BagIcon/><span className="bag-dot">0</span></Link>
    </div>
    <button className="menu" onClick={()=>setOpen(v=>!v)}>{open?'CLOSE':'MENU'}</button>
  </div></header>
}

function Home({products}){
  const latest=(products.length?products:fallbackProducts).slice(0,4)
  const heroProduct=latest[0]
  const heroImage=heroProduct?.image_urls?.[0]
  return <main className="home">
    <section className="hero-editorial">
      <div className="shell hero-layout">
        <div className="hero-left">
          <div className="hero-title">MORE<br/>THAN<br/>SNEAKERS</div>
          <div className="hero-script">IT&apos;S A LIFESTYLE.</div>
          <p className="hero-copy">Curated pre-owned sneakers.<br/>Authentic pieces. New stories.<br/>Worldwide.</p>
          <Link to="/shop" className="hero-shop-btn">SHOP NOW <span>→</span></Link>
          <div className="trust-row">
            <div className="trust-item"><CheckIcon/><span>AUTHENTIC<br/>& VERIFIED</span></div>
            <div className="trust-item"><BoxIcon/><span>WORLDWIDE<br/>SHIPPING</span></div>
            <div className="trust-item"><GlobeIcon/><span>TRUSTED BY<br/>SNEAKER LOVERS</span></div>
          </div>
        </div>

        <div className="hero-center">
          <div className="mascot-stage">
            <img src="/haqlooks-logo.svg" alt="HAQLOOKS mascot" className="mascot-logo"/>
          </div>
        </div>

        <div className="hero-right">
          <div className="scribble crown">♕</div>
          <div className="scribble green-note">GOOD<br/>SNEAKERS<br/>BETTER<br/>PEOPLE</div>
          <div className="vertical-words">BUY<br/>SELL<br/>WEAR<br/>REPEAT</div>
          <div className="brand-tape">HAQLOOKS</div>
          <div className="est-note">EST. 2026</div>
          <div className="globe-mark"><GlobeIcon/></div>
          <div className="collage-shoe">
            {heroImage?<img src={heroImage} alt={heroProduct.name}/>:<FallbackVisual p={heroProduct||fallbackProducts[0]}/>} 
          </div>
        </div>
      </div>
    </section>

    <section className="shell latest-section">
      <div className="latest-head">
        <h2>LATEST DROP</h2>
        <span>CAREFULLY SELECTED. READY FOR A NEW OWNER.</span>
        <Link to="/shop" className="view-all">View all →</Link>
      </div>
      <div className="grid product-grid-home">
        {latest.map((p,i)=><Card key={p.id} p={p} badge={p.status==='sold'?'SOLD':i===0?'NEW':i===3?'HOT':''}/>) }
      </div>
    </section>

    <section className="shell vibe-section">
      <div className="vibe-head"><h2>SHOP BY VIBE</h2><span>DIFFERENT STYLES. SAME ENERGY.</span></div>
      <div className="vibe-grid">
        <VibeCard title="CLASSIC ICONS" product={latest[0]} tone="classic"/>
        <VibeCard title="STREET ESSENTIALS" product={latest[1]} tone="street"/>
        <VibeCard title="BOLD STATEMENTS" product={latest[3]||latest[2]} tone="bold"/>
        <VibeCard title="DAILY BEATERS" product={latest[2]||latest[0]} tone="daily"/>
      </div>
    </section>

    <section className="story-section">
      <div className="shell story-grid">
        <div className="story-poster">
          <div className="poster-frame"><img src="/haqlooks-logo.svg" alt="HAQLOOKS mascot poster"/></div>
          <div className="paper-note">SAME<br/>SNEAKERS<br/>DIFFERENT<br/>STORIES</div>
        </div>
        <div className="story-copy-block">
          <p className="story-label">OUR STORY</p>
          <h2>FROM SNEAKERS<br/>TO A BIGGER COMMUNITY.</h2>
          <p>HAQLOOKS started with a simple idea — giving iconic sneakers a second home. We curate authentic, high-quality pre-owned pieces for people who see sneakers as more than just shoes, but a part of their story.</p>
        </div>
        <div className="story-benefits">
          <Benefit icon={<GlobeIcon/>} title="WORLDWIDE SHIPPING" copy="From Indonesia to everywhere you are."/>
          <Benefit icon={<ShieldIcon/>} title="AUTHENTIC & QUALITY CHECKED" copy="Every pair is carefully inspected."/>
          <Benefit icon={<LeafIcon/>} title="A MORE SUSTAINABLE CHOICE" copy="Great sneakers. Longer stories."/>
          <div className="story-doodle">GOOD<br/>THINGS<br/>CIRCULATE<br/>:)</div>
        </div>
      </div>
    </section>

    <section className="newsletter-band">
      <div className="shell newsletter-inner">
        <div className="newsletter-title"><GlobeIcon/><h2>SNEAKERS<br/>HAVE NO BORDERS</h2></div>
        <div className="newsletter-copy">Join our journey and get the latest drops, updates, and exclusive picks.</div>
        <div className="newsletter-form"><input type="email" placeholder="Enter your email"/><button type="button">JOIN →</button></div>
        <div className="newsletter-scribble">WORLDWIDE<br/>SHIPPING ✈</div>
      </div>
    </section>
  </main>
}

function Benefit({icon,title,copy}){
  return <div className="benefit"><div className="benefit-icon">{icon}</div><div><strong>{title}</strong><p>{copy}</p></div></div>
}

function VibeCard({title,product,tone}){
  const img=product?.image_urls?.[0]
  return <Link to="/shop" className={`vibe-card ${tone}`}>
    <div className="vibe-media">{img?<img src={img} alt={title}/>:<FallbackVisual p={product||fallbackProducts[0]}/>}</div>
    <div className="vibe-overlay"><h3>{title}</h3><span>Shop now →</span></div>
  </Link>
}

function Card({p,badge=''}){
  const img=p.image_urls?.[0]
  const label=badge|| (p.status==='sold'?'SOLD':'')
  return <article className="card product-card-precise">
    <Link to={`/product/${p.slug}`} className="visual product-media">
      {img?<img src={img} alt={p.name}/>:<FallbackVisual p={p}/>} 
      {label?<span className={`drop-badge ${label.toLowerCase()}`}>{label}</span>:null}
      <span className="heart">♡</span>
    </Link>
    <div className="card-body product-info">
      <h3><Link to={`/product/${p.slug}`}>{p.brand} {p.model||p.name}</Link></h3>
      <p>{p.name}</p>
      <div className="product-meta-line"><span>{p.condition} Condition</span><span>{p.size_label||'Ask size'}</span></div>
      <div className="product-price-row"><strong>{money(p.price_idr)}</strong><Link to={`/product/${p.slug}`} className="card-arrow">→</Link></div>
    </div>
  </article>
}

function FallbackVisual({p}){ return <div className={`fallback fallback-${p?.id?.slice(-1)||'x'}`}><span className="shoe-word">{p?.model||p?.brand||'HAQLOOKS'}</span><b>{initials(p?.name||'HAQLOOKS')}</b><small>CURATED / PRE-OWNED</small></div> }
function Status({s}){ return <span className={`status ${s}`}>{String(s).toUpperCase()}</span> }

function Shop({products,loading}){
  const [q,setQ]=useState(''); const [st,setSt]=useState('all')
  const filtered=useMemo(()=>products.filter(p=>(`${p.name} ${p.brand} ${p.model||''} ${p.size_label||''}`.toLowerCase().includes(q.toLowerCase()))&&(st==='all'||p.status===st)),[products,q,st])
  return <PageIntro eyebrow="HAQLOOKS STORE" title="ALL PAIRS" copy="Curated pre-owned sneakers. One listing usually means one actual pair."><div className="filters"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search model, brand, size..."/><select value={st} onChange={e=>setSt(e.target.value)}><option value="all">All status</option><option value="available">Available</option><option value="reserved">Reserved</option><option value="sold">Sold</option></select></div>{loading?<Empty text="LOADING DROP..."/>:<div className="grid">{filtered.map(p=><Card p={p} key={p.id}/>)}</div>}</PageIntro>
}
function Archive({products}){ const sold=products.filter(p=>p.status==='sold'); return <PageIntro eyebrow="HAQLOOKS HISTORY" title="THE ARCHIVE" copy="Pairs that found a new owner stay here. More heat, more stories, same standard.">{sold.length?<div className="grid">{sold.map(p=><Card p={p} key={p.id}/>)}</div>:<Empty text="ARCHIVE IS WAITING FOR ITS FIRST SOLD PAIR."/>}</PageIntro> }
function About(){ return <PageIntro eyebrow="ABOUT HAQLOOKS" title={<>MORE THAN<br/>SNEAKERS.</>} copy="HAQLOOKS is a curated pre-owned sneaker store from Indonesia. We give iconic pairs a second home and build a bigger community around sneakers, style, and stories."><div className="editorial">{[['01','Curated with character.','Every pair should feel selected, not mass listed.'],['02','Photos before promises.','Pre-owned shopping works best when buyers can inspect the pair clearly.'],['03','Indonesia to anywhere.','Built for local and international buyers with worldwide shipping support.']].map(x=><article key={x[0]}><span>{x[0]}</span><h2>{x[1]}</h2><p>{x[2]}</p></article>)}</div></PageIntro> }
function Shipping(){ return <PageIntro eyebrow="SHIPS FROM INDONESIA" title="WORLDWIDE SHIPPING" copy="International shipping is quoted per destination, pair size, and courier availability."><div className="editorial shipping">{[['01','Choose a pair','Check size, condition, status, and photos.'],['02','Message HAQLOOKS','Send the product plus destination country and postal code.'],['03','Get a quote','Shipping is confirmed before payment.'],['04','Pack & ship','Your pair is packed and shipped from Indonesia.']].map(x=><article key={x[0]}><span>{x[0]}</span><h2>{x[1]}</h2><p>{x[2]}</p></article>)}</div><div className="notice">Import taxes, customs fees, and local duties may be charged by the destination country and are the buyer’s responsibility.</div></PageIntro> }

function PageIntro({eyebrow,title,copy,children}){ return <main className="page"><section className="shell intro"><p className="eyebrow orange">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></section><section className="shell section">{children}</section></main> }
function Empty({text}){ return <div className="empty"><b>{text}</b></div> }

function ProductDetail({product}){
  if(!product) return <NotFound/>
  const imgs=product.image_urls||[]
  const msg=encodeURIComponent(`Hi HAQLOOKS, I'm interested in ${product.name} (${product.slug}). Is it still available?`)
  const wa=WHATSAPP?`https://wa.me/${WHATSAPP}?text=${msg}`:`https://www.instagram.com/haqlook/`
  return <main className="page"><section className="shell detail"><div className="gallery">{imgs.length?imgs.map((u,i)=><div className="photo" key={u+i}><img src={u} alt={`${product.name} ${i+1}`}/></div>):<div className="photo big"><FallbackVisual p={product}/></div>}</div><aside className="summary"><p className="eyebrow">{product.brand}</p><h1>{product.name}</h1><div className="summary-status"><Status s={product.status}/><span>{product.condition}</span></div><div className="price">{money(product.price_idr)}</div>{product.price_usd?<small>≈ US${product.price_usd}</small>:null}<dl><div><dt>Model</dt><dd>{product.model||'—'}</dd></div><div><dt>Size</dt><dd>{product.size_label||'Ask us'}</dd></div><div><dt>Condition</dt><dd>{product.condition}</dd></div><div><dt>Ships from</dt><dd>Indonesia</dd></div></dl><p className="desc">{product.description||'Please review all photos carefully for condition and details.'}</p>{product.status==='available'?<a className="btn primary wide" href={wa} target="_blank" rel="noreferrer">ASK / BUY NOW</a>:<button className="btn disabled wide" disabled>{product.status==='sold'?'SOLD — ARCHIVED':'CURRENTLY RESERVED'}</button>}<a className="btn outline wide" href="https://www.instagram.com/haqlook/" target="_blank" rel="noreferrer">MESSAGE ON INSTAGRAM ↗</a><Link to="/shop" className="textlink back">← BACK TO SHOP</Link></aside></section></main>
}

function AdminLogin(){
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [msg,setMsg]=useState(''); const [busy,setBusy]=useState(false)
  async function submit(e){ e.preventDefault(); if(!supabase){setMsg('Supabase environment variables are not configured yet.');return} setBusy(true);setMsg(''); const {data,error}=await supabase.auth.signInWithPassword({email,password}); if(error){setMsg(error.message);setBusy(false);return} const {data:admin,error:aerr}=await supabase.from('admins').select('user_id').eq('user_id',data.user.id).maybeSingle(); if(aerr||!admin){await supabase.auth.signOut();setMsg('This account is not registered as a HAQLOOKS admin.');setBusy(false);return} navigate('/admin') }
  return <main className="login-wrap"><div className="login-card"><div className="admin-brand">HAQLOOKS</div><p className="eyebrow orange">ADMIN ACCESS</p><h1>Manage the drop.</h1><form onSubmit={submit}><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{msg&&<div className="error">{msg}</div>}<button className="btn primary wide" disabled={busy}>{busy?'SIGNING IN...':'SIGN IN'}</button></form></div></main>
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
  return <main className="admin-shell"><div className="admin-head"><div><p className="eyebrow orange">HAQLOOKS ADMIN</p><h1>Product dashboard</h1></div><div className="actions"><button className="btn primary" onClick={()=>setEditing({})}>+ ADD PRODUCT</button><button className="btn outline" onClick={logout}>SIGN OUT</button></div></div><div className="stats">{Object.entries(stats).map(([k,v])=><div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>{msg&&<div className="error">{msg}</div>}<div className="panel"><div className="panel-head"><h2>Products</h2><button className="textlink fake" onClick={load}>REFRESH ↻</button></div>{!items.length?<Empty text="NO DATABASE PRODUCTS YET."/>:<div className="table-wrap"><table><thead><tr><th>Product</th><th>Status</th><th>Size</th><th>Price</th><th>Published</th><th></th></tr></thead><tbody>{items.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small>{p.brand} · {p.slug}</small></td><td><Status s={p.status}/></td><td>{p.size_label||'—'}</td><td>{money(p.price_idr)}</td><td>{p.is_published?'YES':'NO'}</td><td><button className="mini" onClick={()=>setEditing(p)}>EDIT</button><button className="mini danger" onClick={()=>remove(p)}>DELETE</button></td></tr>)}</tbody></table></div>}</div>{editing!==null&&<ProductModal product={editing.id?editing:null} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);load()}}/>}</main>
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

function Footer(){
  return <footer id="contact"><div className="shell footer-grid precise-footer">
    <div><div className="footer-brand">HAQLOOKS</div><p>Pre-owned sneakers. New stories.</p></div>
    <div><strong>Shop</strong><Link to="/shop">All Products</Link><Link to="/shop">New Arrivals</Link><Link to="/archive">Archive</Link></div>
    <div><strong>About</strong><Link to="/about">Our Story</Link><Link to="/shipping">Shipping</Link><a href="https://www.instagram.com/haqlook/" target="_blank" rel="noreferrer">Instagram</a></div>
    <div><strong>Follow Us</strong><a href="https://www.instagram.com/haqlook/" target="_blank" rel="noreferrer">Instagram @haqlook</a><span>Let&apos;s talk sneakers.</span></div>
    <div className="footer-bottom"><span>© 2026 HAQLOOKS. All rights reserved.</span><span>◎ Indonesia</span><span>Sneakers. People. A Better Tomorrow.</span></div>
  </div></footer>
}

createRoot(document.getElementById('root')).render(<App />)
