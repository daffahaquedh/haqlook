const V3_MARK = 'data-haqlooks-v3'

function link(href, label, cls='') {
  return `<a href="${href}" class="${cls}" data-v3-link>${label}</a>`
}

function applyHomeV3() {
  if (location.pathname !== '/') return
  const hero = document.querySelector('.hero')
  if (!hero || hero.hasAttribute(V3_MARK)) return
  hero.setAttribute(V3_MARK, '1')
  hero.classList.add('hero-v3')

  const copy = hero.querySelector('.hero-copy')
  if (copy) {
    copy.innerHTML = `
      <p class="v3-kicker">Curated pre-owned sneakers from Indonesia</p>
      <h1>MORE<br>THAN<br>SNEAKERS</h1>
      <div class="v3-script">It's a lifestyle.</div>
      <p class="v3-lead">Curated pre-owned sneakers. Authentic pieces. New stories. Worldwide.</p>
      <div class="v3-actions">
        ${link('/shop','SHOP NOW →','btn primary')}
        ${link('/archive','EXPLORE ARCHIVE','btn outline')}
      </div>
      <div class="v3-trust">
        <div><span>◌</span><small>AUTHENTIC & VERIFIED</small></div>
        <div><span>⬚</span><small>WORLDWIDE SHIPPING</small></div>
        <div><span>◎</span><small>TRUSTED BY SNEAKER LOVERS</small></div>
      </div>`
  }

  const art = hero.querySelector('.mascot')
  if (art) {
    art.className = 'v3-hero-art'
    art.innerHTML = `
      <img src="/haqlooks-logo.svg" alt="HAQLOOKS mascot" class="v3-mascot-logo">
      <div class="v3-note v3-note-a">GOOD SNEAKERS<br>BETTER PEOPLE</div>
      <div class="v3-note v3-note-b">BUY<br>SELL<br>WEAR<br>REPEAT</div>
      <div class="v3-est">HAQLOOKS · EST. 2026</div>`
  }

  const firstSection = document.querySelector('main > .shell.section')
  if (firstSection) {
    firstSection.classList.add('v3-latest')
    const head = firstSection.querySelector('.section-head')
    if (head) {
      head.innerHTML = `
        <div><p class="eyebrow orange">FEATURED DROPS</p><h2>LATEST DROP</h2></div>
        <p class="v3-micro">CAREFULLY SELECTED. READY FOR A NEW OWNER.</p>
        ${link('/shop','VIEW ALL →','textlink')}`
    }
  }

  const manifesto = document.querySelector('.manifesto')
  if (manifesto) {
    manifesto.insertAdjacentHTML('beforebegin', `
      <section class="shell v3-vibe-section" ${V3_MARK}="1">
        <div class="v3-section-head"><h2>SHOP BY VIBE</h2><span>DIFFERENT STYLES. SAME ENERGY.</span></div>
        <div class="v3-vibes">
          ${vibe('/shop','CLASSIC ICONS','/haqlooks-logo.svg')}
          ${vibe('/shop','STREET ESSENTIALS','/haqlooks-logo.svg')}
          ${vibe('/shop','BOLD STATEMENTS','/haqlooks-logo.svg')}
          ${vibe('/shop','DAILY BEATERS','/haqlooks-logo.svg')}
        </div>
      </section>
      <section class="shell v3-story" ${V3_MARK}="1">
        <div class="v3-story-poster"><img src="/haqlooks-logo.svg" alt="HAQLOOKS"><span>SAME SNEAKERS. DIFFERENT STORIES.</span></div>
        <div class="v3-story-copy"><p class="eyebrow">OUR STORY</p><h2>FROM SNEAKERS TO A BIGGER COMMUNITY.</h2><p>HAQLOOKS started with a simple idea — giving iconic sneakers a second home. We curate authentic, high-quality pre-owned pieces for people who see sneakers as more than just shoes, but a part of their story.</p></div>
        <div class="v3-story-points">
          <div><b>WORLDWIDE SHIPPING</b><span>From Indonesia to everywhere you are.</span></div>
          <div><b>AUTHENTIC & QUALITY CHECKED</b><span>Every pair is carefully inspected.</span></div>
          <div><b>A MORE SUSTAINABLE CHOICE</b><span>Great sneakers. Longer stories.</span></div>
        </div>
      </section>`)

    manifesto.outerHTML = `
      <section class="v3-newsletter" ${V3_MARK}="1">
        <div class="shell v3-newsletter-inner">
          <div><p class="eyebrow">WORLDWIDE</p><h2>SNEAKERS HAVE NO BORDERS</h2></div>
          <form class="v3-newsletter-form"><input type="email" placeholder="Enter your email"><button class="btn primary" type="submit">JOIN →</button></form>
        </div>
      </section>`
  }

  wireLinks()
}

function vibe(href, label, img) {
  return `<a href="${href}" class="v3-vibe" data-v3-link><img src="${img}" alt="${label}"><div><b>${label}</b><span>Shop now →</span></div></a>`
}

function wireLinks() {
  document.querySelectorAll('[data-v3-link]').forEach(a => {
    if (a.dataset.bound) return
    a.dataset.bound = '1'
    a.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      history.pushState({}, '', a.getAttribute('href'))
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
  })
  document.querySelectorAll('.v3-newsletter-form').forEach(f => f.addEventListener('submit', e => e.preventDefault()))
}

function polishCards() {
  document.querySelectorAll('.card').forEach(card => {
    if (card.dataset.v3Card) return
    card.dataset.v3Card = '1'
    const visual = card.querySelector('.visual')
    if (visual) {
      const status = visual.querySelector('.status')
      if (status) {
        const wrap = document.createElement('div')
        wrap.className = 'v3-card-top'
        status.replaceWith(wrap)
        wrap.append(status)
        wrap.insertAdjacentHTML('beforeend','<span class="v3-heart">♡</span>')
      }
    }
    const meta = card.querySelector('.card-meta')
    if (meta) meta.classList.add('v3-card-meta')
  })
}

function enhance() {
  applyHomeV3()
  polishCards()
}

const obs = new MutationObserver(() => enhance())
obs.observe(document.documentElement, { childList: true, subtree: true })
window.addEventListener('popstate', () => setTimeout(enhance, 0))
window.addEventListener('DOMContentLoaded', enhance)
setTimeout(enhance, 0)
