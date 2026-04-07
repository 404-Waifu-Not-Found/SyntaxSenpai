// Desktop renderer: interactive UI with search, favorites, and micro-interactions
// Works standalone (no build) and merges built waifus if available.
const appEl = document.getElementById('app');

async function tryLoadBuiltWaifus() {
  // Use dynamic import to support ESM-built packages
  try {
    const pkg = await import('@syntax-senpai/waifu-core');
    if (pkg && Array.isArray(pkg.builtInWaifus)) return pkg.builtInWaifus;
  } catch (e) {
    // ignore
    console.debug('import @syntax-senpai/waifu-core failed:', e && e.message ? e.message : e);
  }
  try {
    // relative import from renderer to packages
    const pkg = await import('../../packages/waifu-core/dist/index.js');
    if (pkg && Array.isArray(pkg.builtInWaifus)) return pkg.builtInWaifus;
  } catch (e) {
    console.debug('import local dist waifu-core failed:', e && e.message ? e.message : e);
  }
  return [];
}

const demoWaifus = [
  { id: 'demo-airi', displayName: 'Airi', backstory: 'Friendly coding assistant who likes clean commits and tea breaks.', emoji: '🌸' },
  { id: 'demo-mika', displayName: 'Mika', backstory: 'Helpful with refactors and speaks in short, clear examples.', emoji: '✨' },
  { id: 'demo-yu', displayName: 'Yuu', backstory: 'Prefers concise code and elegant animations.', emoji: '🎨' },
  { id: 'demo-ken', displayName: 'Ken', backstory: 'Loves automated tests and will gently nag you about coverage.', emoji: '🛡️' },
  { id: 'demo-rin', displayName: 'Rin', backstory: 'Quick with suggestions and a fan of tiny micro-interactions.', emoji: '⚡' },
  { id: 'demo-noa', displayName: 'Noa', backstory: 'Keeps your workspace tidy and organizes tabs.', emoji: '🧹' },
];

function mergeWaifus(built, demo) {
  const map = new Map();
  (built || []).forEach(w => {
    const id = w.id || w.name || w.displayName || JSON.stringify(w);
    map.set(id, Object.assign({ id }, w));
  });
  (demo || []).forEach(w => {
    if (!map.has(w.id)) map.set(w.id, w);
  });
  return Array.from(map.values());
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem('ss:favorites');
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(arr);
  } catch (e) { return new Set(); }
}

function saveFavorites(set) {
  try { localStorage.setItem('ss:favorites', JSON.stringify(Array.from(set))); } catch (e) {}
}

function createStyles() {
  const css = `
  :root { --bg: #f6f7fb; --card: #fff; --muted:#666; --accent:#ff3366; }
  body { margin:0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; background: var(--bg); color: #111; }
  .ss-container { max-width:980px; margin:18px auto; padding:12px; }
  .ss-header { display:flex; gap:12px; align-items:center; justify-content:space-between; }
  .ss-search { flex:1; margin-left:12px; }
  .ss-search input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid #e3e6ee; background:#fff; }
  .ss-waifu-list { margin-top:14px; display:grid; grid-template-columns: repeat(auto-fill, minmax(280px,1fr)); gap:12px; }
  .ss-card { background: var(--card); border-radius:12px; padding:12px; box-shadow: 0 6px 18px rgba(16,24,40,0.06); display:flex; gap:12px; align-items:flex-start; cursor:default; transition: transform 180ms ease, box-shadow 180ms ease; transform-origin: center; }
  .ss-card:hover { transform: translateY(-6px); box-shadow: 0 12px 30px rgba(16,24,40,0.10); }
  .ss-avatar { width:64px; height:64px; border-radius:12px; background:#fff; display:flex; align-items:center; justify-content:center; font-size:32px; flex:0 0 64px; }
  .ss-info { flex:1; }
  .ss-name { font-weight:600; }
  .ss-backstory { margin-top:6px; color:var(--muted); font-size:13px; }
  .ss-actions { display:flex; flex-direction:column; gap:8px; align-items:center; }
  .ss-fav { background:transparent; border:0; cursor:pointer; font-size:20px; line-height:1; }
  .ss-fav.favorited { color: var(--accent); transform: scale(1.05); }
  .ss-fav .pulse { animation: pulse 380ms ease; }
  @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.22); } 100% { transform: scale(1); } }
  .ss-empty { padding:28px; text-align:center; color:var(--muted); }
  `;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
}

function truncate(str, n=160) { if (!str) return ''; return str.length>n? str.slice(0,n-1)+'…': str; }

function renderApp(allWaifus) {
  createStyles();
  const favorites = loadFavorites();
  const container = document.createElement('div'); container.className = 'ss-container';

  container.innerHTML = `
    <div class="ss-header">
      <div style="display:flex;align-items:center;gap:12px">
        <h1 style="margin:0;font-size:18px">SyntaxSenpai Desktop</h1>
        <div style="font-size:13px;color:#666">Quick (dev) mode</div>
      </div>
      <div class="ss-search">
        <input id="ss-search-input" placeholder="Search waifus by name or description..." />
      </div>
    </div>
    <div style="display:flex;gap:12px;align-items:center;margin-top:10px">
      <label style="font-size:13px;color:#444"><input id="ss-fav-only" type="checkbox"/> Favorites only</label>
      <div style="margin-left:auto;color:#666;font-size:13px">Total: <span id="ss-count">0</span></div>
    </div>
    <div id="ss-waifu-list" class="ss-waifu-list"></div>
  `;

  appEl.innerHTML = ''; appEl.appendChild(container);

  const listEl = container.querySelector('#ss-waifu-list');
  const searchInput = container.querySelector('#ss-search-input');
  const favOnlyEl = container.querySelector('#ss-fav-only');
  const countEl = container.querySelector('#ss-count');

  function getFiltered() {
    const q = (searchInput.value || '').toLowerCase().trim();
    const favOnly = favOnlyEl.checked;
    const filtered = allWaifus.filter(w => {
      const name = (w.displayName||w.name||'').toLowerCase();
      const bio = (w.backstory||'').toLowerCase();
      const match = q === '' || name.includes(q) || bio.includes(q);
      if (!match) return false;
      if (favOnly) return favorites.has(w.id);
      return true;
    });
    // favorites first
    filtered.sort((a,b)=> (favorites.has(b.id)?1:0) - (favorites.has(a.id)?1:0));
    return filtered;
  }

  function renderList() {
    const items = getFiltered();
    listEl.innerHTML = '';
    countEl.textContent = String(items.length);
    if (items.length === 0) {
      const empt = document.createElement('div'); empt.className = 'ss-empty'; empt.textContent = 'No waifus match your search.'; listEl.appendChild(empt); return; }

    items.forEach(w => {
      const card = document.createElement('div'); card.className = 'ss-card';

      const avatar = document.createElement('div'); avatar.className = 'ss-avatar'; avatar.textContent = w.emoji || (w.avatarEmoji || '🎀');
      const info = document.createElement('div'); info.className = 'ss-info';
      const name = document.createElement('div'); name.className = 'ss-name'; name.textContent = w.displayName || w.name || w.id || 'Unnamed';
      const bio = document.createElement('div'); bio.className = 'ss-backstory'; bio.textContent = truncate(w.backstory || '', 140);
      info.appendChild(name); info.appendChild(bio);

      const actions = document.createElement('div'); actions.className = 'ss-actions';
      const favBtn = document.createElement('button'); favBtn.className = 'ss-fav'; favBtn.setAttribute('aria-label','Toggle favorite');
      favBtn.innerHTML = favorites.has(w.id) ? '❤️' : '🤍'; if (favorites.has(w.id)) favBtn.classList.add('favorited');

      favBtn.addEventListener('click', (e)=>{
        e.preventDefault(); e.stopPropagation();
        if (favorites.has(w.id)) { favorites.delete(w.id); favBtn.innerHTML = '🤍'; favBtn.classList.remove('favorited'); }
        else { favorites.add(w.id); favBtn.innerHTML = '❤️'; favBtn.classList.add('favorited'); favBtn.querySelector('svg'); }
        // pulse animation
        favBtn.classList.add('pulse'); setTimeout(()=>favBtn.classList.remove('pulse'), 420);
        saveFavorites(favorites);
        renderList();
      });

      actions.appendChild(favBtn);

      card.appendChild(avatar); card.appendChild(info); card.appendChild(actions);

      // mouse tilt micro-interaction
      card.addEventListener('mousemove', (ev)=>{
        const r = card.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width; const y = (ev.clientY - r.top) / r.height;
        const rotateY = (x - 0.5) * 8; const rotateX = -(y - 0.5) * 8;
        card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      });
      card.addEventListener('mouseleave', ()=>{ card.style.transform = ''; });

      listEl.appendChild(card);
    });
  }

  searchInput.addEventListener('input', ()=> renderList());
  favOnlyEl.addEventListener('change', ()=> renderList());

  renderList();
}

(async function boot() {
  const built = await tryLoadBuiltWaifus();
  const all = mergeWaifus(built, demoWaifus);
  renderApp(all);
})();
