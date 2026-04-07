// Minimal renderer for quick local dev
const appEl = document.getElementById('app');
if (appEl) {
  appEl.innerHTML = `
    <p>Hello, SyntaxSenpai! The desktop app is running.</p>
    <p>Open devtools to inspect the window.</p>
  `;
}
