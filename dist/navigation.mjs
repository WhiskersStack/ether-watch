export function setupNavigation(doc = document, win = window) {
  const header = doc.querySelector('.terminal-header');
  const nav = doc.getElementById('terminal-navigation');
  const toggle = doc.getElementById('navigation-toggle');
  const links = [...nav.querySelectorAll('a')];
  let preferred = null, queued = false, navigating = false;
  const headerOffset = () => header.getBoundingClientRect().height + (parseFloat(win.getComputedStyle(header).top) || 0) + 20;
  function activate(id) {
    for (const link of links) {
      const active = link.hash === '#' + id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
  function sections() {
    return links.map(link => {
      const id = link.hash.slice(1), node = id === 'overview' ? doc.querySelector('.metrics') : doc.getElementById(id);
      return { id, top: node.getBoundingClientRect().top + win.scrollY };
    }).sort((a, b) => a.top - b.top);
  }
  function update() {
    queued = false;
    const offset = headerOffset();
    doc.documentElement.style.setProperty('--header-offset', offset + 'px');
    if (doc.getElementById('expanded-chart-dialog').open) return;
    if (win.scrollY <= 4) { if (!navigating) preferred = null; activate('overview'); return; }
    const groups = [];
    for (const section of sections()) {
      const previous = groups.at(-1);
      if (previous && Math.abs(previous.top - section.top) <= 32) previous.ids.push(section.id);
      else groups.push({ top: section.top, ids: [section.id] });
    }
    let current = groups[0];
    for (const group of groups) if (group.top <= win.scrollY + offset + 2) current = group;
    // A short final section cannot reach the header once the document stops scrolling.
    if (win.scrollY + win.innerHeight >= doc.documentElement.scrollHeight - 2) current = groups.at(-1);
    if (current.ids.includes(preferred)) navigating = false;
    else if (!navigating) preferred = null;
    activate(current.ids.includes(preferred) ? preferred : (current.ids.includes('chart-panel') ? 'chart-panel' : current.ids.includes('news') ? 'news' : current.ids[0]));
  }
  function schedule() { if (!queued) { queued = true; win.requestAnimationFrame(update); } }
  function follow(hash, focus = false) {
    if (hash === '#alerts') { hash = '#overview'; win.history.replaceState(null, '', hash); }
    const target = doc.getElementById(hash.slice(1));
    if (!target || !links.some(link => link.hash === hash)) { schedule(); return; }
    toggle.setAttribute('aria-expanded', 'false');
    preferred = hash.slice(1);
    navigating = true;
    if (focus) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
    // Measure the collapsed header, not the open mobile menu.
    const offset = headerOffset();
    const top = hash === '#overview' ? 0 : target.getBoundingClientRect().top + win.scrollY - offset;
    activate(preferred);
    win.scrollTo({ top: Math.max(0, top), behavior: win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    schedule();
  }
  toggle.addEventListener('click', () => { toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') !== 'true')); schedule(); });
  for (const link of [...links, doc.querySelector('.brand')]) link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (win.location.hash !== link.hash) win.history.pushState(null, '', link.hash);
    follow(link.hash, true);
  });
  header.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); schedule();
    }
  });
  win.addEventListener('scroll', schedule, { passive: true });
  for (const event of ['wheel', 'touchstart']) win.addEventListener(event, () => { navigating = false; }, { passive: true });
  doc.addEventListener('keydown', event => { if (['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(event.key)) navigating = false; });
  win.addEventListener('resize', schedule);
  win.addEventListener('hashchange', () => follow(win.location.hash));
  win.addEventListener('popstate', () => follow(win.location.hash || '#overview'));
  const observer = new win.ResizeObserver(schedule);
  observer.observe(header); observer.observe(doc.querySelector('main'));
  win.requestAnimationFrame(() => win.requestAnimationFrame(() => win.location.hash ? follow(win.location.hash) : update()));
}
