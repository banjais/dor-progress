import{b as i,p as g,o as m,s as b,c as f,k as d,f as h,a as v,A as x,t as r,l as S,B as w,d as k,u as T,D as E}from"./index-DWFdYGcU.js";import"./vendor-jspdf-C_IQQS5S.js";const a=E.getInstance();async function l(){return"dev-bypass"}async function D(o){const t=o?.target||document.getElementById("create-snapshot-btn");if(!t)return;const e=t.innerText;t.innerText="Creating...",t.disabled=!0;try{const s=await l();if(!s){t.innerText=e,t.disabled=!1;return}if(!a.state.store){a.addToast("error","No data"),t.innerText=e,t.disabled=!1;return}const c=await i("/api/snapshot",{method:"POST",headers:{"X-Snapshot-Key":s},body:JSON.stringify({headers:a.state.store.headers||[],records:a.state.store.rows||[],meta:{lastUpdate:a.state.store.lastUpdate||new Date().toISOString().split("T")[0],total:a.state.store.rows.length}})});await g(c,m({success:f(),date:b().optional()})),a.addToast("success","Snapshot created!"),y(!0)}catch(s){console.error("Error creating snapshot:",s),a.addToast("error",d(s).message)}finally{t.innerText=e,t.disabled=!1}}async function y(o){const t=document.getElementById("snapshot-list-container"),e=document.getElementById("snapshot-list");if(!(!t||!e)){if(t.style.display!=="none"&&!o){t.style.display="none";return}try{const s=await l();if(!s)return;const c=await i("/api/reports",{headers:{"X-Snapshot-Key":s}}),p=await g(c,v(x));p.length===0?e.innerHTML="<p style='font-size: 0.7rem;'>No snapshots</p>":(p.sort((n,u)=>u.date.localeCompare(n.date)),e.innerHTML=p.map(n=>`
              <div style="background: var(--bg); border-radius: 8px; padding: 10px; border: 1px solid var(--border); margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                  <span style="font-size: 0.75rem; font-weight: 800; color: var(--primary);">${n.date}</span>
                </div>
                <div style="font-size: 0.65rem; color: var(--text-light);">${r("records")||"Records"}: ${a.state.lang==="ne"?S(n.recordCount):n.recordCount}</div>
                <div style="display: flex; gap: 5px; margin-top: 5px;">
                  <button onclick="App.downloadSnapshot('${n.date}')" class="toggle-btn" style="flex: 1; padding: 5px; font-size: 0.65rem; border: 1px solid var(--primary); background: transparent; color: var(--primary); cursor: pointer;">Download</button>
                  <button onclick="App.deleteSnapshot('${n.date}')" class="toggle-btn" style="flex: 1; padding: 5px; font-size: 0.65rem; border: 1px solid var(--critical); background: transparent; color: var(--critical); cursor: pointer;">Delete</button>
                </div>
              </div>
            `).join("")),t.style.display="block"}catch(s){a.addToast("error",d(s).message)}}}async function z(o){const t=await l();if(t)try{const e=await i(`/api/snapshot?date=${o}`,{headers:{"X-Snapshot-Key":t}});h(await e.blob(),`DoR_Snapshot_${o}.pdf`)}catch(e){a.addToast("error",d(e).message)}}async function A(o){if(!confirm(`Delete ${o}?`))return;const t=await l();if(t)try{await i(`/api/snapshot?date=${o}`,{method:"DELETE",headers:{"X-Snapshot-Key":t}}),y(!0)}catch(e){a.addToast("error",d(e).message)}}const I=async()=>{const o=document.getElementById("modal-body"),t=document.getElementById("modal-overlay");if(!o||!t)return;o.innerHTML=`
      <div class="modal-header">
        <h3 style="margin:0; color:var(--primary)">⚙️ ${r("settings")||"Settings"}</h3>
        <p style="font-size:0.8rem; opacity:0.7; margin-top:5px;">System configuration and update management.</p>
      </div>
      <div style="padding: 20px 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 15px; background: var(--bg); border-radius: 16px; border: 1px solid var(--border);">
            <div>
                <b style="font-size: 0.65rem; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.05em;">Application Version</b>
                <div style="font-size: 1.1rem; font-weight: 800; color: var(--primary);">v${w.config.version||"1.0.0"}</div>
            </div>
            <button id="settings-check-update" class="retry-btn" style="margin: 0; padding: 10px 20px; font-size: 0.8rem; border-radius: 10px;">
                🔄 ${r("checkForUpdates")||"Check for Updates"}
            </button>
        </div>

        <div class="modal-item" style="margin-top: 15px;">
             <b style="color: var(--text-light); font-size: 0.75rem; text-transform: uppercase; margin-bottom: 10px; display: block;">${r("maintenance")}</b>
             <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <button class="toggle-btn" onclick="App.clearDataCache()" style="font-size: 0.75rem; border: 1px solid var(--border);">${r("clearCache")}</button>
                <button class="toggle-btn" onclick="App.logoutSnapshotSession()" style="font-size: 0.75rem; border: 1px solid var(--border);">${r("logoutAdmin")||"Logout Admin"}</button>
             </div>
        </div>
      </div>
      <div style="text-align: right; margin-top: 10px; padding-top: 15px; border-top: 1px solid var(--border);">
        <button id="settings-close" class="toggle-btn active" style="padding: 10px 30px; border-radius: 10px;">${r("close")}</button>
      </div>
    `,t.style.display="flex";const e=document.getElementById("settings-check-update");e?.addEventListener("click",()=>{k(e)}),T(e),document.getElementById("settings-close")?.addEventListener("click",()=>{t.style.display="none"})};async function C(){console.log("Backup triggered")}async function L(){console.log("Restore triggered")}async function R(){console.log("Downloading offline data")}function U(){localStorage.clear(),location.reload()}function K(){localStorage.clear(),sessionStorage.clear(),location.reload()}function M(){a.logout()}export{U as clearDataCache,D as createSnapshotManual,A as deleteSnapshot,R as downloadAllOfflineData,z as downloadSnapshot,K as executeFactoryReset,y as listSnapshots,M as logoutSnapshotSession,l as requestSnapshotKey,I as showSettings,C as triggerDatabaseBackup,L as triggerDatabaseRestore};
