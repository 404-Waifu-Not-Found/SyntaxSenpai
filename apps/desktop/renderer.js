// Enhanced renderer: selection, chat, API selection, settings, and agent execution
const { ipcRenderer } = require('electron');
const appEl = document.getElementById('app');

async function tryLoadBuiltWaifus() {
  try {
    const pkg = await import('@syntax-senpai/waifu-core');
    if (pkg && Array.isArray(pkg.builtInWaifus)) return pkg.builtInWaifus;
  } catch (e) { console.debug('import @syntax-senpai/waifu-core failed:', e && e.message ? e.message : e); }
  try {
    const pkg = await import('../../packages/waifu-core/dist/index.js');
    if (pkg && Array.isArray(pkg.builtInWaifus)) return pkg.builtInWaifus;
  } catch (e) { console.debug('import local dist waifu-core failed:', e && e.message ? e.message : e); }
  return [];
}

const demoWaifus = [
  { id: 'demo-airi', displayName: 'Airi', backstory: 'Friendly coding assistant who likes clean commits and tea breaks.', emoji: '🌸' },
  { id: 'demo-mika', displayName: 'Mika', backstory: 'Helpful with refactors and speaks in short, clear examples.', emoji: '✨' },
  { id: 'demo-yuu', displayName: 'Yuu', backstory: 'Prefers concise code and elegant animations.', emoji: '🎨' },
  { id: 'demo-ken', displayName: 'Ken', backstory: 'Loves automated tests and will gently nag you about coverage.', emoji: '🛡️' },
  { id: 'demo-rin', displayName: 'Rin', backstory: 'Quick with suggestions and a fan of tiny micro-interactions.', emoji: '⚡' },
  { id: 'demo-noa', displayName: 'Noa', backstory: 'Keeps your workspace tidy and organizes tabs.', emoji: '🧹' },
];

function mergeWaifus(built, demo) {
  const map = new Map();
  (built || []).forEach(w => { const id = w.id || w.name || w.displayName || JSON.stringify(w); map.set(id, Object.assign({ id }, w)); });
  (demo || []).forEach(w => { if (!map.has(w.id)) map.set(w.id, w); });
  return Array.from(map.values());
}

function loadFavorites() { try { const raw = localStorage.getItem('ss:favorites'); if (!raw) return new Set(); return new Set(JSON.parse(raw)); } catch (e) { return new Set(); } }
function saveFavorites(set) { try { localStorage.setItem('ss:favorites', JSON.stringify(Array.from(set))); } catch (e) {} }
function loadMessages(id) { try { const raw = localStorage.getItem('ss:chat:' + id); if (!raw) return []; return JSON.parse(raw); } catch (e) { return []; } }
function saveMessages(id, messages) { try { localStorage.setItem('ss:chat:' + id, JSON.stringify(messages)); } catch (e) {} }

function createStyles() {
  const css = `
  :root { --bg: #f6f7fb; --card: #fff; --muted:#666; --accent:#ff3366; }
  body { margin:0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; background: var(--bg); color: #111; }
  .ss-container { max-width:1200px; margin:12px auto; padding:12px; }
  .ss-top { display:flex; gap:12px; align-items:center; justify-content:space-between; }
  .ss-layout { display:grid; grid-template-columns: 340px 1fr; gap:12px; margin-top:12px; }
  .ss-panel { background:var(--card); border-radius:10px; padding:10px; box-shadow: 0 6px 18px rgba(16,24,40,0.06); }
  .ss-search input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid #e3e6ee; background:#fff; }
  .ss-waifu-list { margin-top:10px; display:flex; flex-direction:column; gap:10px; max-height:68vh; overflow:auto; }
  .ss-card { display:flex; gap:12px; align-items:center; padding:8px; border-radius:8px; cursor:pointer; }
  .ss-card:hover { background:#f3f4f8; }
  .ss-card.active { outline:2px solid rgba(255,51,102,0.12); background:linear-gradient(90deg,#fff 0%, #fff 100%); }
  .ss-avatar { width:56px;height:56px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:26px;background:#fff }
  .ss-name { font-weight:600 }
  .ss-backstory { color:var(--muted); font-size:12px }
  .ss-chat { display:flex; flex-direction:column; height:72vh; }
  .ss-messages { flex:1; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:8px; }
  .ss-msg.user { align-self:flex-end; background:#eff6ff; padding:8px 10px; border-radius:8px; max-width:80%; }
  .ss-msg.assistant { align-self:flex-start; background:#fff; padding:8px 10px; border-radius:8px; max-width:80%; box-shadow: 0 2px 8px rgba(16,24,40,0.04);} 
  .ss-input { display:flex; gap:8px; padding:8px; align-items:center; }
  .ss-input textarea { flex:1; padding:8px; border-radius:8px; border:1px solid #e6e9f0; min-height:44px; }
  .ss-actions { display:flex; gap:8px; align-items:center }
  .ss-settings { display:flex; gap:8px; align-items:center }
  .ss-small { font-size:12px; color:var(--muted) }
  `;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
}

function truncate(str, n=160) { if (!str) return ''; return str.length>n? str.slice(0,n-1)+'…': str; }

function renderApp(allWaifus) {
  createStyles();
  const favorites = loadFavorites();
  let selectedId = null;

  const container = document.createElement('div'); container.className = 'ss-container';
  container.innerHTML = `
    <div class="ss-top">
      <div style="display:flex;align-items:center;gap:12px">
        <h1 style="margin:0;font-size:18px">SyntaxSenpai Desktop</h1>
        <div class="ss-small">Local agent demo</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <label class="ss-small">API:</label>
        <select id="ss-api-select"><option value="local">Local (built-in)</option><option value="openai">OpenAI</option></select>
        <button id="ss-settings-btn">Settings</button>
      </div>
    </div>

    <div class="ss-layout">
      <div class="ss-panel">
        <div class="ss-search"><input id="ss-search-input" placeholder="Search waifus..." /></div>
        <div style="margin-top:8px"><label><input id="ss-fav-only" type="checkbox"/> Favorites only</label></div>
        <div id="ss-waifu-list" class="ss-waifu-list"></div>
      </div>

      <div id="ss-main" class="ss-panel ss-chat">
        <div id="ss-main-header" style="display:flex;justify-content:space-between;align-items:center">
          <div id="ss-selected-name">Select a waifu to chat</div>
          <div style="display:flex;gap:8px;align-items:center" class="ss-settings"><span id="ss-selected-status" class="ss-small"></span></div>
        </div>

        <div id="ss-messages" class="ss-messages"></div>

        <div class="ss-input">
          <textarea id="ss-input" placeholder="Say something..."></textarea>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label style="display:flex;flex-direction:column;align-items:flex-end"><input id="ss-exec-cmd" type="checkbox"/> Execute as command</label>
            <div class="ss-actions"><button id="ss-send">Send</button></div>
          </div>
        </div>
      </div>
    </div>

    <div id="ss-settings-modal" style="display:none;position:fixed;right:18px;top:80px;background:#fff;border-radius:10px;padding:12px;box-shadow:0 12px 40px rgba(16,24,40,0.12);width:320px;z-index:999">
      <h3 style="margin:0 0 8px 0">Settings</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        <label><input id="ss-allow-system" type="checkbox"/> Allow system control (run commands)</label>
        <label><input id="ss-open-dev" type="checkbox"/> Open DevTools on launch</label>
        <label>OpenAI API Key (optional): <input id="ss-api-key" type="password" style="width:100%" /></label>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button id="ss-save-settings">Save</button><button id="ss-close-settings">Close</button></div>
      </div>
    </div>
  `;

  appEl.innerHTML = ''; appEl.appendChild(container);

  const listEl = container.querySelector('#ss-waifu-list');
  const searchInput = container.querySelector('#ss-search-input');
  const favOnlyEl = container.querySelector('#ss-fav-only');
  const messagesEl = container.querySelector('#ss-messages');
  const selectedNameEl = container.querySelector('#ss-selected-name');
  const selectedStatusEl = container.querySelector('#ss-selected-status');
  const inputEl = container.querySelector('#ss-input');
  const execCheckbox = container.querySelector('#ss-exec-cmd');
  const sendBtn = container.querySelector('#ss-send');
  const apiSelect = container.querySelector('#ss-api-select');
  const settingsBtn = container.querySelector('#ss-settings-btn');
  const settingsModal = container.querySelector('#ss-settings-modal');
  const allowSystemEl = container.querySelector('#ss-allow-system');
  const openDevEl = container.querySelector('#ss-open-dev');
  const apiKeyEl = container.querySelector('#ss-api-key');
  const saveSettingsBtn = container.querySelector('#ss-save-settings');
  const closeSettingsBtn = container.querySelector('#ss-close-settings');

  async function loadSettings() {
    try { const s = await ipcRenderer.invoke('settings:get'); if (s) { allowSystemEl.checked = !!s.allowSystemControl; openDevEl.checked = !!s.openDevTools; apiKeyEl.value = s.apiKey || ''; apiSelect.value = s.apiProvider || 'local'; } } catch (e) { console.debug('settings get failed', e); }
  }
  async function saveSettings() {
    const s = { allowSystemControl: !!allowSystemEl.checked, openDevTools: !!openDevEl.checked, apiProvider: apiSelect.value, apiKey: apiKeyEl.value };
    await ipcRenderer.invoke('settings:set', s);
    settingsModal.style.display = 'none';
  }

  function renderMessages(messages) {
    messagesEl.innerHTML = '';
    messages.forEach(m => {
      const el = document.createElement('div'); el.className = 'ss-msg ' + (m.role === 'user' ? 'user' : 'assistant'); el.textContent = m.content; messagesEl.appendChild(el);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function openChatFor(waifu) {
    selectedId = waifu.id;
    selectedNameEl.textContent = waifu.displayName || waifu.name || waifu.id;
    selectedStatusEl.textContent = waifu.backstory ? truncate(waifu.backstory, 80) : '';
    const msgs = loadMessages(selectedId);
    renderMessages(msgs);
  }

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
    filtered.sort((a,b)=> (favorites.has(b.id)?1:0) - (favorites.has(a.id)?1:0));
    return filtered;
  }

  function renderList() {
    const items = getFiltered();
    listEl.innerHTML = '';
    if (items.length === 0) { const empt = document.createElement('div'); empt.className = 'ss-small'; empt.textContent = 'No waifus found.'; listEl.appendChild(empt); return; }
    items.forEach(w => {
      const card = document.createElement('div'); card.className = 'ss-card' + (selectedId === w.id ? ' active' : '');
      const avatar = document.createElement('div'); avatar.className = 'ss-avatar'; avatar.textContent = w.emoji || '🎀';
      const info = document.createElement('div'); info.style.flex='1'; const name = document.createElement('div'); name.className='ss-name'; name.textContent = w.displayName || w.name || w.id; const bio = document.createElement('div'); bio.className='ss-backstory'; bio.textContent = truncate(w.backstory||'', 80);
      info.appendChild(name); info.appendChild(bio);
      card.appendChild(avatar); card.appendChild(info);

      card.addEventListener('click', ()=>{ openChatFor(w); renderList(); });

      listEl.appendChild(card);
    });
  }

  async function doAgentResponse(userText) {
    const waifu = allWaifus.find(w=>w.id===selectedId);
    if (!waifu) return;
    const messages = loadMessages(selectedId);

    if (execCheckbox.checked || userText.trim().startsWith('/cmd ')) {
      const cmd = userText.trim().startsWith('/cmd ') ? userText.trim().slice(5) : userText.trim();
      messages.push({ role: 'assistant', content: 'Executing command: ' + cmd }); saveMessages(selectedId, messages); renderMessages(messages);
      try {
        const result = await ipcRenderer.invoke('agent:exec', { command: cmd });
        if (result.action === 'open-settings') { settingsModal.style.display='block'; return; }
        const out = (result.stdout || '') + (result.stderr ? '\nERR: ' + result.stderr : '');
        messages.push({ role: 'assistant', content: out || '(no output)' }); saveMessages(selectedId, messages); renderMessages(messages);
      } catch (e) {
        messages.push({ role: 'assistant', content: 'Execution failed: ' + String(e) }); saveMessages(selectedId, messages); renderMessages(messages);
      }
      return;
    }

    const reply = `${waifu.displayName || waifu.name || 'Agent'}: I heard you — "${userText}". I can run commands if you toggle 'Execute as command' or enable system control in Settings.`;
    messages.push({ role: 'assistant', content: reply }); saveMessages(selectedId, messages); renderMessages(messages);
  }

  sendBtn.addEventListener('click', async ()=>{
    const txt = inputEl.value.trim(); if (!txt) return; const messages = loadMessages(selectedId); messages.push({ role: 'user', content: txt }); saveMessages(selectedId, messages); renderMessages(messages); inputEl.value = ''; await doAgentResponse(txt);
  });

  settingsBtn.addEventListener('click', ()=>{ settingsModal.style.display = settingsModal.style.display === 'none' ? 'block' : 'none'; loadSettings(); });
  saveSettingsBtn.addEventListener('click', saveSettings);
  closeSettingsBtn.addEventListener('click', ()=> settingsModal.style.display = 'none');

  searchInput.addEventListener('input', renderList); favOnlyEl.addEventListener('change', renderList);

  ipcRenderer.on('agent:stream', (ev, data)=>{
    const messages = loadMessages(selectedId);
    let last = messages[messages.length-1];
    if (!last || last.role !== 'assistant') { messages.push({ role: 'assistant', content: data.data }); }
    else { last.content += data.data; }
    saveMessages(selectedId, messages); renderMessages(messages);
  });

  renderList();
}

(async function boot(){
  const built = await tryLoadBuiltWaifus();
  const all = mergeWaifus(built, demoWaifus);
  renderApp(all);
})();
