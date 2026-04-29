#!/usr/bin/env node

/**
 * Simple Hybrid Build – Extract CSS & JS to separate files
 *
 * Fast, simple, reliable:
 * 1. Extract ALL CSS → styles.css (deferred)
 * 2. Inline minimal critical CSS (~8 KB)
 * 3. Extract ALL JS → app.js (deferred)
 * 4. Add resource hints (preload, preconnect)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const cwd = process.cwd();
const publicDir = path.resolve(cwd, 'public');
const buildDir = path.resolve(cwd, '.build');

console.log('\n⚡ Fast Hybrid Build\n');

// Clean + copy
execSync(`rm -rf ${buildDir.replace(/\\/g, '/')} && cp -r ${publicDir.replace(/\\/g, '/')} ${buildDir.replace(/\\/g, '/')}`);

// Read HTML
const htmlPath = path.join(publicDir, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// ============================================
// 1. Extract CSS
// ============================================

const cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const fullCss = cssMatch ? cssMatch[1] : '';

// Critical CSS – above-the-fold elements only, with latest font clarity fixes
const criticalCss = `
:root{--primary:#0099da;--primary-dark:#0077aa;--bg:#f0f4f8;--surface:#fff;--text:#111827;--text-light:#4b5563;--good:#10b981;--stable:#3b82f6;--critical:#ef4444;--border:#e5e7eb;--hover:rgba(0,0,0,.03);--selected-bg:rgba(0,153,218,.1)}
[data-theme="dark"]{--bg:#0b0f1a;--surface:#151c2e;--text:#f9fafb;--text-light:#9ca3af;--border:#2d3748;--primary:#38bdf8;--primary-dark:#0ea5e9;--hover:rgba(255,255,255,.06);--selected-bg:rgba(56,189,248,.2)}
html{box-sizing:border-box}*,*:before,*:after{box-sizing:inherit}body{margin:0;font-family:"Noto Sans Devanagari","Roboto",sans-serif;background:var(--bg);color:var(--text);transition:background-color .5s,color .5s;-webkit-font-smoothing:auto;text-rendering:optimizeLegibility}
header{background:linear-gradient(135deg,var(--primary) 0%,var(--primary-dark) 100%);background-color:var(--primary);color:#fff;padding:.5rem 5%;position:sticky;top:0;z-index:100;height:48px;display:flex;align-items:center;box-shadow:0 4px 12px rgba(0,153,218,.2);-webkit-font-smoothing:auto;text-rendering:optimizeLegibility}
.header-top{display:flex;justify-content:space-between;align-items:center;gap:20px;width:100%}
header h2{margin:0;font-size:1rem;display:flex;align-items:center;gap:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;-webkit-font-smoothing:auto;text-rendering:optimizeLegibility;text-shadow:none}
#action-bar{background:var(--surface);padding:12px 5%;border-bottom:1px solid var(--border);position:sticky;top:48px;z-index:90}
.search-container{position:relative;flex-grow:1;max-width:400px}
.search-container input{width:100%;padding:10px 75px 10px 40px;border-radius:12px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.85rem;outline:none;transition:border .3s}
.search-container i{position:absolute;left:15px;top:11px;opacity:.5}
.toggle-group{background:var(--bg);padding:4px;border-radius:10px;display:flex;gap:3px;box-shadow:inset 0 2px 4px rgba(0,0,0,.05)}
.toggle-btn{background:var(--surface);border:none;color:var(--text-light);padding:8px 16px;border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,.1);transition:all .2s cubic-bezier(.4,0,.2,1);-webkit-font-smoothing:auto;text-rendering:optimizeLegibility}
.icon-btn{background:var(--surface);border:1px solid var(--border);width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:10px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,.1);font-size:1.1rem;-webkit-font-smoothing:auto;text-rendering:optimizeLegibility}
.status-btn{background:rgba(255,255,255,.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:.85rem;transition:all .2s;-webkit-font-smoothing:auto;text-rendering:optimizeLegibility}
#loader{position:fixed;inset:0;background:var(--bg);display:flex;justify-content:center;align-items:center;z-index:1000}
#loader .chart-container{width:60px;height:60px;margin:0 auto 15px}
#loader .spinning{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#kpi-row{display:flex;gap:1.5rem;margin-bottom:2rem;align-items:stretch}
#kpi-stats{flex:2;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem}
.kpi-card{background:var(--surface);padding:1rem 1.5rem;border-radius:16px;border:1px solid var(--border);border-left:5px solid var(--primary);box-shadow:0 4px 6px -1px rgba(0,0,0,.05);margin-bottom:1rem}
.info-bar{max-width:1400px;margin:.8rem auto .2rem;padding:0 5%}
/* Mobile-first responsive – applies immediately on small screens */
@media (max-width: 767px) {
  #btn-table { display: none !important; }
  #btn-cards { display: flex !important; }
  #view-table { display: none !important; }
  #view-cards { display: block !important; }
  .data-card { width: 100% !important; max-width: none !important; }
  .table-wrapper { overflow-x: hidden; }
  table { min-width: auto; }
  #action-bar { flex-direction: column; }
  #kpi-row { flex-direction: column; }
  .toggle-btn { padding: 10px 16px !important; font-size: 0.85rem !important; }
  .icon-btn, .status-btn { width: 44px !important; height: 44px !important; }
  header h2 { font-size: 0.85rem; }
}
/* Tablet – show table with limited columns */
@media (min-width: 768px) and (max-width: 1024px) {
  #btn-table { display: flex !important; }
  #btn-cards { display: none !important; }
  #view-table { display: block !important; }
  #view-cards { display: none !important; }
  /* Show first 6 columns, hide others */
  th:nth-child(n+7), td:nth-child(n+7) { display: none; }
  .icon-btn, .status-btn { width: 38px !important; height: 38px !important; }
}
`;

const nonCriticalCss = fullCss.replace(criticalCss, '').replace(/^\s*\n/mg, '');

html = html.replace(/<style>[\s\S]*?<\/style>/, `<style>${criticalCss}</style>`);

console.log(`   CSS: ${Math.round(fullCss.length/1024)} KB → critical ${Math.round(criticalCss.length/1024)} KB + deferred ${Math.round(nonCriticalCss.length/1024)} KB`);

// ============================================
// 2. Extract JavaScript
// ============================================

const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
const fullJs = scriptMatch ? scriptMatch[1] : '';

if (!fullJs) {
  console.error('❌ No inline JS found');
  process.exit(1);
}

// Write external JS file
fs.writeFileSync(path.join(buildDir, 'app.js'), fullJs);
console.log(`   JS: ${Math.round(fullJs.length/1024)} KB → app.js`);

// Replace entire inline script block with external reference
html = html.replace(
  /<script type="module">[\s\S]*?<\/script>/,
  '<script type="module" src="/app.js" defer></script>'
);

// ============================================
// 3. Add Resource Hints & Preloads
// ============================================

html = html.replace('</head>', `
<link rel="preload" href="/styles.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="/styles.css"></noscript>
<link rel="preconnect" href="https://www.gstatic.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="dns-prefetch" href="https://firebaseinstallations.googleapis.com">
</head>`);

// Write updated HTML
fs.writeFileSync(path.join(buildDir, 'index.html'), html);
console.log('✅ index.html updated');

// Write deferred CSS
fs.writeFileSync(path.join(buildDir, 'styles.css'), nonCriticalCss);
console.log('✅ styles.css');

// Copy other assets
['manifest.json', 'logo.png', 'logo-192.png', 'logo-512.png', 'offline.html', 'sw.v2.js'].forEach(f => {
  fs.copyFileSync(path.join(publicDir, f), path.join(buildDir, f));
});

// ============================================
// 4. Inject env vars
// ============================================

console.log('\n🔧 Injecting env vars...');

const commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const buildId = `${Date.now().toString(36).slice(-6)}-${commitSha}`;
const apiBase = process.env.API_BASE_URL || '';

let finalHtml = fs.readFileSync(path.join(buildDir, 'index.html'), 'utf8')
  .replace(/__API_BASE_URL__/g, apiBase)
  .replace(/__BUILD_ID__/g, buildId)
  .replace(/__COMMIT_SHA__/g, commitSha);
fs.writeFileSync(path.join(buildDir, 'index.html'), finalHtml);

const appJs = fs.readFileSync(path.join(buildDir, 'app.js'), 'utf8')
  .replace(/__API_BASE_URL__/g, apiBase)
  .replace(/__BUILD_ID__/g, buildId)
  .replace(/__COMMIT_SHA__/g, commitSha);
fs.writeFileSync(path.join(buildDir, 'app.js'), appJs);

const sw = fs.readFileSync(path.join(buildDir, 'sw.v2.js'), 'utf8')
  .replace(/__API_BASE_URL__/g, apiBase)
  .replace(/__BUILD_ID__/g, buildId)
  .replace(/__COMMIT_SHA__/g, commitSha);
fs.writeFileSync(path.join(buildDir, 'sw.v2.js'), sw);

console.log('✅ Environment injected');

// ============================================
// 5. Summary
// ============================================

console.log('\n📦 Build Output:');
const files = fs.readdirSync(buildDir).sort();
let total = 0;
for (const f of files) {
  const s = fs.statSync(path.join(buildDir, f)).size;
  total += s;
  if (f !== '_inline.js' && f !== 'tsconfig.tsbuildinfo') {
    console.log(`   ${f.padStart(30)} ${(s/1024).toFixed(1)} KB`);
  }
}
console.log(`   ${'Total:'.padEnd(30)} ${(total/1024).toFixed(1)} KB`);

console.log('\n✨ Hybrid build complete!\n');
console.log('Next: npm run deploy:hosting or npm run deploy\n');
