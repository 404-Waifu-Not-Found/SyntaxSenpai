// Renderer: show built-in waifus (falls back to message if packages aren't built)
const appEl = document.getElementById('app');

function safeLoadBuiltInWaifus() {
  // Try to load via package name (pnpm workspace) then fallback to local dist
  try {
    const pkg = require('@syntax-senpai/waifu-core');
    if (pkg && Array.isArray(pkg.builtInWaifus)) return pkg.builtInWaifus;
  } catch (e) {
    // ignore and try fallback
  }

  try {
    const pkg = require('../../packages/waifu-core/dist/index.js');
    if (pkg && Array.isArray(pkg.builtInWaifus)) return pkg.builtInWaifus;
  } catch (e) {
    console.error('Failed to load builtInWaifus from dist or package:', e);
  }

  return [];
}

const waifus = safeLoadBuiltInWaifus();

if (appEl) {
  if (!waifus || waifus.length === 0) {
    appEl.innerHTML = `
      <h2>SyntaxSenpai Desktop</h2>
      <p>No waifus found. Run <code>pnpm -w -r run build</code> from the repo root to build packages, then restart the app.</p>
      <p>Or open DevTools to inspect errors.</p>
    `;
  } else {
    const listHtml = waifus.map(w => {
      const name = w.displayName || w.name || w.id || 'Unnamed';
      const backstory = w.backstory ? (w.backstory.length > 140 ? w.backstory.slice(0,140) + '…' : w.backstory) : '';
      const emoji = (w.communicationStyle && w.communicationStyle.signatureEmojis && w.communicationStyle.signatureEmojis[0]) || '🎀';
      return `<div style="display:flex;gap:12px;align-items:flex-start;padding:10px;border-bottom:1px solid #eee">
        <div style="width:72px;height:72px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:28px">${emoji}</div>
        <div style="flex:1">
          <div style="font-weight:600">${name}</div>
          <div style="color:#555;margin-top:6px">${backstory}</div>
        </div>
      </div>`;
    }).join('');

    appEl.innerHTML = `
      <div style="max-width:920px;margin:0 auto;">
        <h2>Built-in Waifus</h2>
        <div style="background:#fff;border-radius:8px;padding:8px;box-shadow:0 6px 18px rgba(16,24,40,0.06)">${listHtml}</div>
      </div>
    `;
  }
}
