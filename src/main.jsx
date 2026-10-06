import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './home-refinement.css'
import './admin.css'
import './seller.css'
import './staff-entry.css'
import SellerApp from './seller.jsx'
import StaffLogin from './staff-auth.jsx'
import { supabase } from './supabase-client'
import {
  buildWhatsAppProductMessage,
  filterAndSortPublicProducts,
  publicProductUrl,
  publicPurchaseAction,
  publicStatusLabel,
} from './public-storefront.js'
import { resolveStorefrontContact } from './store-contact.js'

function money(value){ return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value||0)) }
function route(){ return window.location.pathname || '/' }
function navigate(path){ window.history.pushState({},'',path); window.dispatchEvent(new PopStateEvent('popstate')) }

function App(){
  const [path,setPath]=useState(route())
  const [products,setProducts]=useState([])
  const [loading,setLoading]=useState(true)
  const [catalogError,setCatalogError]=useState(false)
  const [staffEntry,setStaffEntry]=useState('checking')
  const [storeContact,setStoreContact]=useState(null)
  const isOperations=path==='/staff' || path.startsWith('/admin') || path.startsWith('/seller')

  useEffect(()=>{ const fn=()=>setPath(route()); addEventListener('popstate',fn); return()=>removeEventListener('popstate',fn) },[])
  useEffect(()=>{ loadPublicProducts() },[])
  useEffect(()=>{
    let active=true
    async function loadStoreContact(){
      if(!supabase){if(active)setStoreContact(null);return}
      try {
        const {data,error}=await supabase.from('storefront_contact_settings').select('whatsapp_number,instagram_url').eq('id',1).maybeSingle()
        if(active)setStoreContact(error?null:data||null)
      } catch {
        if(active)setStoreContact(null)
      }
    }
    void loadStoreContact()
    return()=>{active=false}
  },[])
  useEffect(()=>{
    if(isOperations || !supabase){setStaffEntry('anonymous');return}
    let active=true
    async function resolveStaffEntry(session){
      if(!session?.user?.id){if(active)setStaffEntry('anonymous');return}
      const {data,error}=await supabase.from('admins').select('user_id,role').eq('user_id',session.user.id).maybeSingle()
      const role=String(data?.role||'').toUpperCase()
      if(active)setStaffEntry(!error && data && ['ADMIN','SELLER'].includes(role)?'staff':'anonymous')
    }
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
      setTimeout(()=>{void resolveStaffEntry(session)},0)
    })
    supabase.auth.getSession().then(({data,error})=>{
      if(error){if(active)setStaffEntry('anonymous');return}
      void resolveStaffEntry(data.session)
    })
    return ()=>{active=false;subscription?.unsubscribe()}
  },[isOperations])
  async function loadPublicProducts(){
    setLoading(true)
    setCatalogError(false)
    if(!supabase){ setProducts([]); setCatalogError(true); setLoading(false); return }
    const {data,error}=await supabase.from('products').select('id,slug,name,brand,model,price_idr,price_usd,size_label,condition,description,status,is_published,image_urls,created_at').eq('is_published',true).order('created_at',{ascending:false})
    if(error){setProducts([]);setCatalogError(true)}
    else setProducts(data||[])
    setLoading(false)
  }

  let page
  if(path==='/') page=<Home products={products} loading={loading} catalogError={catalogError} onRetry={loadPublicProducts} />
  else if(path==='/shop') page=<Shop products={products} loading={loading} catalogError={catalogError} onRetry={loadPublicProducts} />
  else if(path==='/archive') page=<Archive products={products} loading={loading} catalogError={catalogError} onRetry={loadPublicProducts} />
  else if(path==='/about') page=<About />
  else if(path==='/shipping') page=<Shipping />
  else if(path==='/privacy') page=<Privacy />
  else if(path==='/staff' || path==='/admin/login') page=<StaffLogin />
  else if(path==='/admin') page=<SellerApp path={path} />
  else if(path==='/seller' || path.startsWith('/seller/')) page=<SellerApp path={path} />
  else if(path.startsWith('/product/')) page=<ProductDetail product={products.find(p=>p.slug===decodeURIComponent(path.split('/').pop()))} loading={loading} catalogError={catalogError} onRetry={loadPublicProducts} contactSettings={storeContact} />
  else page=<NotFound />

  return isOperations?<>{page}</>:<><Nav path={path} staffEntry={staffEntry}/>{page}<Footer staffEntry={staffEntry}/></>
}

function Link({to,children,className='',onNavigate,...props}){
  return <a href={to} className={className} {...props} onClick={event=>{
    props.onClick?.(event)
    if(event.defaultPrevented || event.metaKey || event.ctrlKey || event.button!==0)return
    event.preventDefault()
    navigate(to)
    onNavigate?.()
  }}>{children}</a>
}

function SearchIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>}
function UserIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.9-4 3.2-6 7-6s6.1 2 7 6"/></svg>}
function BagIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg>}
function GlobeIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z"/></svg>}

function Nav({path,staffEntry}){
  const [open,setOpen]=useState(false)
  const menuButtonRef=useRef(null)
  const links=[['/','Home'],['/shop','Shop'],['/about','About'],['/shipping','Shipping']]
  function closeMenu(){if(open)menuButtonRef.current?.focus();setOpen(false)}
  useEffect(()=>{setOpen(false)},[path])
  useEffect(()=>{
    if(!open)return
    function onKeyDown(event){
      if(event.key==='Escape'){setOpen(false);menuButtonRef.current?.focus()}
    }
    window.addEventListener('keydown',onKeyDown)
    return ()=>window.removeEventListener('keydown',onKeyDown)
  },[open])
  return <header className="nav"><div className="shell nav-inner">
    <Link to="/" className="brand-wordmark">HAQLOOKS</Link>
    <nav id="public-navigation" aria-label="Navigasi utama" className={open?'nav-links open':'nav-links'}>
      {links.map(([href,label])=>{
        const active=href==='/'?path==='/':path.startsWith(href)
        return <Link key={href} to={href} onNavigate={closeMenu} aria-current={active?'page':undefined} className={active?'active':''}>{label}</Link>
      })}
      <a href="#contact" onClick={()=>{setOpen(false);menuButtonRef.current?.focus()}}>Contact</a>
      <div className="nav-account-secondary"><span>Akun staf</span><Link to={staffEntry==='staff'?'/seller':'/staff'} onNavigate={closeMenu}>{staffEntry==='staff'?'Panel':'Staff Login'} <span aria-hidden="true">→</span></Link></div>
    </nav>
    <div className="nav-tools">
      <Link to="/shop" className="icon-btn" aria-label="Search"><SearchIcon/></Link>
      <Link to={staffEntry==='staff'?'/seller':'/staff'} className="icon-btn staff-entry-link" aria-label={staffEntry==='staff'?'Buka Panel':'Staff Login'} title={staffEntry==='staff'?'Panel':'Staff Login'}><UserIcon/>{staffEntry==='staff'&&<span>Panel</span>}</Link>
      <Link to="/shop" className="icon-btn bag-btn" aria-label="Shop"><BagIcon/><span className="bag-dot">0</span></Link>
    </div>
    <button ref={menuButtonRef} type="button" className="menu" aria-label={open?'Tutup menu navigasi':'Buka menu navigasi'} aria-expanded={open} aria-controls="public-navigation" onClick={()=>setOpen(value=>!value)}>{open?'CLOSE':'MENU'}</button>
  </div></header>
}

function Home({products,loading,catalogError,onRetry}){
  const latest=products.slice(0,4)
  const heroProduct=latest[0]
  const heroImage=heroProduct?.image_urls?.[0]
  return <main className="home">
    <section className="hero-editorial">
      <div className="shell hero-layout">
        <div className="hero-left">
          <div className="hero-title">MORE<br/>THAN<br/>SNEAKERS</div>
          <div className="hero-script">IT&apos;S A LIFESTYLE.</div>
          <p className="hero-copy">Kurasi sneakers pre-owned.<br/>Detail kondisi dan ukuran ditampilkan jelas.</p>
          <Link to="/shop" className="hero-shop-btn">JELAJAHI BARANG <span aria-hidden="true">→</span></Link>
        </div>

        <div className="hero-center">
          <div className="mascot-stage">
            <img src="/mascot-latest.png" alt="" className="mascot-logo" fetchPriority="high" decoding="async"/>
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
            {heroImage?<img src={heroImage} alt="" loading="lazy" decoding="async"/>:<div className="collage-placeholder" aria-hidden="true">HAQLOOKS / ARCHIVE</div>}
          </div>
        </div>
      </div>
    </section>

    <section className="shell latest-section">
      <div className="latest-head">
        <h2>BARANG TERBARU</h2>
        <span>Pasangan terkurasi, siap menemukan pemilik baru.</span>
        <Link to="/shop" className="view-all">Lihat semua <span aria-hidden="true">→</span></Link>
      </div>
      {loading?<ProductGridSkeleton label="Memuat barang terbaru"/>:catalogError?<CatalogUnavailable onRetry={onRetry}/>:latest.length?<div className="grid public-product-grid product-grid-home">{latest.map(p=><Card key={p.id} p={p}/>)}</div>:<Empty text="Belum ada barang yang ditampilkan saat ini."/>}
    </section>

    <section className="shell discovery-section" aria-labelledby="discovery-title">
      <div className="discovery-intro">
        <p className="eyebrow">JELAJAHI HAQLOOKS</p>
        <h2 id="discovery-title">Cari pasangan yang terasa seperti kamu.</h2>
        <p>Mulai dari koleksi yang tersedia, lihat pasangan yang sudah menemukan pemilik, atau kenali cerita kami.</p>
      </div>
      <nav className="discovery-links" aria-label="Jelajahi Haqlooks">
        <Link to="/shop"><span>01 / KOLEKSI</span><strong>Semua barang</strong><span aria-hidden="true">→</span></Link>
        <Link to="/archive"><span>02 / ARSIP</span><strong>Pasangan terjual</strong><span aria-hidden="true">→</span></Link>
        <Link to="/about"><span>03 / CERITA</span><strong>Tentang Haqlooks</strong><span aria-hidden="true">→</span></Link>
      </nav>
    </section>

    <section className="shell buying-guide" aria-labelledby="buying-guide-title">
      <div>
        <p className="eyebrow">BELANJA DENGAN PERCAYA DIRI</p>
        <h2 id="buying-guide-title">Lihat detailnya. Tanyakan yang perlu.</h2>
        <p>Pilih barang, cek ukuran dan kondisi, lalu hubungi kami untuk memastikan ketersediaan. Biaya pengiriman dihitung sesuai tujuan.</p>
      </div>
      <Link to="/shipping" className="textlink">CARA BELI & PENGIRIMAN <span aria-hidden="true">→</span></Link>
    </section>
  </main>
}

function Card({p}){
  const img=p.image_urls?.[0]
  return <article className="card product-card-precise">
    <Link to={`/product/${p.slug}`} className="visual product-media">
      {img?<img src={img} alt={`${p.brand||''} ${p.name}`} loading="lazy" decoding="async"/>:<div className="product-image-unavailable">Foto belum tersedia</div>}
    </Link>
    <div className="card-body product-info">
      {p.brand?<p className="product-brand">{p.brand}</p>:null}
      <h3><Link to={`/product/${p.slug}`}>{p.name}</Link></h3>
      <div className="product-meta-line"><span>{p.size_label||'Ukuran belum tersedia'}</span><span>{p.condition||'Kondisi belum tersedia'}</span></div>
      <div className="product-price-row"><strong>{money(p.price_idr)}</strong><Status s={p.status}/></div>
    </div>
  </article>
}

function Status({s}){
  const label=publicStatusLabel(s)
  return <span className={`status ${String(s||'').toLowerCase()}`} aria-label={`Status barang: ${label}`}>{label}</span>
}

function ProductGridSkeleton({label='Memuat koleksi'}){
  return <div className="grid public-product-grid product-grid-skeleton" role="status" aria-label={label} aria-busy="true">
    {Array.from({length:4},(_,index)=><div className="skeleton-product" key={index} aria-hidden="true"><div className="skeleton-image"/><div className="skeleton-line wide"/><div className="skeleton-line"/><div className="skeleton-line short"/></div>)}
  </div>
}

function CatalogUnavailable({onRetry}){
  return <div className="catalog-message" role="alert"><p>Etalase belum dapat dimuat. Coba lagi sebentar.</p>{onRetry?<button className="catalog-retry" type="button" onClick={onRetry}>Coba lagi</button>:null}</div>
}

function Shop({products,loading,catalogError,onRetry}){
  const [query,setQuery]=useState('')
  const [status,setStatus]=useState('all')
  const [sort,setSort]=useState('newest')
  const filtered=useMemo(()=>filterAndSortPublicProducts(products,{query,status,sort}),[products,query,status,sort])
  return <PageIntro eyebrow="HAQLOOKS STORE" title="ALL PAIRS" copy="Sneakers pre-owned terkurasi. Setiap listing mewakili satu pasangan.">
    <div className="filters shop-filters">
      <label className="shop-search"><span className="sr-only">Cari brand, nama barang, atau ukuran</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Cari brand, nama, ukuran…" autoComplete="off"/></label>
      <label><span className="sr-only">Filter status barang</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="all">Semua status</option><option value="available">Tersedia</option><option value="reserved">Dipesan</option><option value="sold">Terjual</option></select></label>
      <label><span className="sr-only">Urutkan barang</span><select value={sort} onChange={event=>setSort(event.target.value)}><option value="newest">Terbaru</option><option value="price-asc">Harga: rendah ke tinggi</option><option value="price-desc">Harga: tinggi ke rendah</option></select></label>
    </div>
    {loading?<ProductGridSkeleton label="Memuat katalog"/>:catalogError?<CatalogUnavailable onRetry={onRetry}/>:filtered.length?<div className="grid public-product-grid">{filtered.map(product=><Card p={product} key={product.id}/>)}</div>:<Empty text="Belum ada barang yang cocok. Coba ubah kata kunci atau status."/>}
  </PageIntro>
}
function Archive({products,loading,catalogError,onRetry}){
  const sold=filterAndSortPublicProducts(products,{status:'sold'})
  return <PageIntro eyebrow="HAQLOOKS HISTORY" title="THE ARCHIVE" copy="Pasangan yang sudah menemukan pemilik baru tetap menjadi bagian dari cerita Haqlooks.">
    {loading?<ProductGridSkeleton label="Memuat arsip"/>:catalogError?<CatalogUnavailable onRetry={onRetry}/>:sold.length?<div className="grid public-product-grid">{sold.map(product=><Card p={product} key={product.id}/>)}</div>:<Empty text="Belum ada pasangan terjual di arsip."/>}
  </PageIntro>
}
function About(){ return <PageIntro eyebrow="ABOUT HAQLOOKS" title={<>MORE THAN<br/>SNEAKERS.</>} copy="HAQLOOKS is a curated pre-owned sneaker store from Indonesia. We give iconic pairs a second home and build a bigger community around sneakers, style, and stories."><div className="editorial">{[['01','Curated with character.','Every pair should feel selected, not mass listed.'],['02','Photos before promises.','Pre-owned shopping works best when buyers can inspect the pair clearly.'],['03','Indonesia to anywhere.','Built for local and international buyers with worldwide shipping support.']].map(x=><article key={x[0]}><span>{x[0]}</span><h2>{x[1]}</h2><p>{x[2]}</p></article>)}</div></PageIntro> }
function Shipping(){ return <PageIntro eyebrow="SHIPS FROM INDONESIA" title="WORLDWIDE SHIPPING" copy="Biaya pengiriman dikonfirmasi sesuai tujuan, ukuran paket, dan ketersediaan kurir."><div className="editorial shipping">{[['01','Pilih barang','Periksa ukuran, kondisi, status, dan foto.'],['02','Hubungi Haqlooks','Kirim tautan barang serta negara dan kode pos tujuan.'],['03','Konfirmasi ongkir','Biaya pengiriman diinformasikan sebelum pembayaran.'],['04','Dikemas & dikirim','Barang dikemas dan dikirim dari Indonesia.']].map(x=><article key={x[0]}><span>{x[0]}</span><h2>{x[1]}</h2><p>{x[2]}</p></article>)}</div><div className="notice">Pajak impor, biaya bea cukai, dan pungutan lokal dapat dikenakan oleh negara tujuan dan menjadi tanggung jawab pembeli.</div><div className="shipping-actions"><Link to="/shop" className="btn primary">Jelajahi barang</Link><a href="https://www.instagram.com/haqlook/" target="_blank" rel="noreferrer" className="textlink">TANYAKAN PENGIRIMAN <span aria-hidden="true">↗</span></a></div></PageIntro> }

function Privacy(){ return <PageIntro eyebrow="HAQLOOKS / PRIVACY" title="PRIVACY POLICY" copy="Cara HAQLOOKS menangani otorisasi eBay untuk fitur operasional toko."><div className="editorial privacy-policy">{[['01','Data yang diproses','Jika Admin menghubungkan eBay, HAQLOOKS menukar authorization code di server dan menyimpan refresh token serta masa berlakunya di penyimpanan server yang tidak dapat dibaca browser. OAuth state disimpan dalam bentuk hash dan kedaluwarsa setelah 10 menit.'],['02','Penggunaan koneksi','Pada tahap koneksi ini HAQLOOKS hanya menyimpan kredensial untuk koneksi eBay. Sistem belum mengambil listing, pesanan, pesan, data pembeli, atau data akun eBay lainnya, dan tidak membuat listing, pembelian, maupun pesan otomatis. eBay menampilkan izin yang diminta sebelum persetujuan.'],['03','Keamanan dan kendali','Token tidak dikirim ke frontend, localStorage, URL akhir, atau log aplikasi. Anda dapat mencabut izin melalui pengaturan akses aplikasi pihak ketiga di akun eBay. Untuk bantuan menghapus koneksi HAQLOOKS, hubungi kami melalui Instagram.'],['04','Pembaruan kebijakan','Jika HAQLOOKS mulai memproses data eBay lain pada masa mendatang, kebijakan ini akan diperbarui sebelum fitur tersebut digunakan.']].map(item=><article key={item[0]}><span>{item[0]}</span><h2>{item[1]}</h2><p>{item[2]}</p></article>)}</div><div className="notice privacy-contact">Pertanyaan privasi? <a href="https://www.instagram.com/haqlook/" target="_blank" rel="noreferrer">Hubungi HAQLOOKS melalui Instagram ↗</a></div></PageIntro> }

function PageIntro({eyebrow,title,copy,children}){ return <main className="page"><section className="shell intro"><p className="eyebrow orange">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></section><section className="shell section">{children}</section></main> }
function Empty({text}){ return <div className="empty"><b>{text}</b></div> }

function ProductDetail({product,loading,catalogError,onRetry,contactSettings}){
  if(!product){
    if(loading)return <main className="page"><div className="shell public-detail-loading" role="status">Memuat detail barang…</div></main>
    if(catalogError)return <main className="page"><div className="shell section"><CatalogUnavailable onRetry={onRetry}/></div></main>
    return <NotFound/>
  }

  const contact=resolveStorefrontContact(contactSettings)
  const action=publicPurchaseAction(product.status,Boolean(contact.whatsappNumber))
  const productUrl=publicProductUrl(window.location.origin,product.slug)
  const message=encodeURIComponent(buildWhatsAppProductMessage(product,productUrl))
  const contactUrl=contact.primaryType==='whatsapp'?`${contact.primaryUrl}?text=${message}`:contact.primaryUrl
  const normalizedStatus=String(product.status||'').toLowerCase()

  return <main className="page public-product-page">
    <section className="shell public-detail-layout">
      <ProductGallery product={product}/>
      <aside className="public-product-summary" aria-labelledby="public-product-title">
        {product.brand?<p className="eyebrow">{product.brand}</p>:null}
        <h1 id="public-product-title">{product.name}</h1>
        <div className="summary-status">
          <Status s={product.status}/>
          {product.size_label?<span>Ukuran {product.size_label}</span>:null}
          {product.condition?<span>Kondisi {product.condition}</span>:null}
        </div>
        <div className="public-product-price">{money(product.price_idr)}</div>
        {product.price_usd?<small className="public-price-secondary">≈ US${product.price_usd}</small>:null}
        {action.disabled?<button className="btn disabled wide" type="button" disabled>{action.label}</button>:<a className="btn primary wide public-primary-cta" href={contactUrl} target="_blank" rel="noreferrer">{action.label}</a>}
        <p className="shipping-hint">Ongkir dihitung sesuai tujuan. <Link to="/shipping">Lihat info pengiriman</Link></p>
        <dl className="public-product-facts">
          {product.model?<div><dt>Model</dt><dd>{product.model}</dd></div>:null}
          <div><dt>Dikirim dari</dt><dd>Indonesia</dd></div>
        </dl>
        <section className="public-condition-copy" aria-labelledby="condition-title">
          <h2 id="condition-title">Kondisi & detail</h2>
          <p className="public-product-description">{product.description||'Silakan periksa foto barang dan tanyakan detail kondisi sebelum membeli.'}</p>
        </section>
        <a className="btn outline wide public-secondary-cta" href={contact.instagramUrl} target="_blank" rel="noreferrer">Tanya lewat Instagram <span aria-hidden="true">↗</span></a>
        {normalizedStatus==='sold'?<p className="public-archive-note">Pasangan ini sudah terjual dan ditampilkan sebagai arsip.</p>:null}
        <Link to="/shop" className="textlink back">← KEMBALI KE TOKO</Link>
      </aside>
    </section>
  </main>
}

function ProductGallery({product}){
  const trackRef=useRef(null)
  const [activeIndex,setActiveIndex]=useState(0)
  const images=(Array.isArray(product.image_urls)?product.image_urls:[]).filter(url=>typeof url==='string'&&url.trim())
  function updatePosition(){
    const track=trackRef.current
    if(track?.clientWidth)setActiveIndex(Math.min(images.length-1,Math.round(track.scrollLeft/track.clientWidth)))
  }
  function goTo(index){
    const track=trackRef.current
    if(!track)return
    track.scrollTo({left:index*track.clientWidth,behavior:'smooth'})
  }
  if(!images.length)return <div className="public-gallery-empty" role="img" aria-label={`Foto ${product.name} belum tersedia`}>Foto barang belum tersedia</div>
  return <div className="public-gallery" role="group" aria-label="Galeri foto barang" aria-roledescription="carousel">
    <div className="public-gallery-track" ref={trackRef} onScroll={updatePosition}>
      {images.map((url,index)=><div className="public-gallery-slide" key={`${url}-${index}`} role="group" aria-label={`Foto ${index+1} dari ${images.length}`}>
        <img src={url} alt={`${product.brand?`${product.brand} `:''}${product.name} — foto ${index+1}`} loading={index===0?'eager':'lazy'} decoding="async" fetchPriority={index===0?'high':'auto'}/>
      </div>)}
    </div>
    <div className="gallery-controls">
      <button type="button" aria-label="Foto sebelumnya" disabled={activeIndex===0} onClick={()=>goTo(activeIndex-1)}>←</button>
      <span aria-live="polite">{activeIndex+1} / {images.length}</span>
      <button type="button" aria-label="Foto berikutnya" disabled={activeIndex>=images.length-1} onClick={()=>goTo(activeIndex+1)}>→</button>
    </div>
  </div>
}

function NotFound(){return <main className="login-wrap"><div className="empty"><b>404 — PAGE NOT FOUND</b><br/><br/><Link to="/" className="textlink">BACK HOME →</Link></div></main>}

function Footer({staffEntry='anonymous'}){
  return <footer id="contact"><div className="shell footer-grid precise-footer">
    <div><div className="footer-brand">HAQLOOKS</div><p>Pre-owned sneakers. New stories.</p></div>
    <div><strong>Shop</strong><Link to="/shop">All Products</Link><Link to="/shop">New Arrivals</Link><Link to="/archive">Archive</Link></div>
    <div><strong>About</strong><Link to="/about">Our Story</Link><Link to="/shipping">Shipping</Link><Link to="/privacy">Privacy Policy</Link><a href="https://www.instagram.com/haqlook/" target="_blank" rel="noreferrer">Instagram</a></div>
    <div><strong>Follow Us</strong><a href="https://www.instagram.com/haqlook/" target="_blank" rel="noreferrer">Instagram @haqlook</a><span>Let&apos;s talk sneakers.</span><Link to={staffEntry==='staff'?'/seller':'/staff'} className="footer-staff-entry">{staffEntry==='staff'?'Panel':'Staff Login'}</Link></div>
    <div className="footer-bottom"><span>© 2026 HAQLOOKS. All rights reserved.</span><span>◎ Indonesia</span><span>Sneakers. People. A Better Tomorrow.</span></div>
  </div></footer>
}

function scrubEbayCallbackQuery(){
  if(window.location.pathname!=='/seller/marketplace-settings')return
  const url=new URL(window.location.href)
  const providerError=url.searchParams.has('error')||url.searchParams.has('error_description')
  const sensitive=['code','state','access_token','refresh_token','error','error_description','expires_in','token_type']
  if(!sensitive.some(key=>url.searchParams.has(key)))return
  sensitive.forEach(key=>url.searchParams.delete(key))
  if(providerError&&!url.searchParams.has('ebay'))url.searchParams.set('ebay','cancelled')
  window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash)
}
scrubEbayCallbackQuery()

createRoot(document.getElementById('root')).render(<App />)

