import{D as a}from"./index-DWFdYGcU.js";import"./vendor-jspdf-C_IQQS5S.js";const e=a.getInstance();function n(t){e.state.search=t,e.state.view!=="cards"&&e.state.view!=="table"&&e.setView("cards"),e.addToast("info",`${e.t("isolating")||"Isolating"}: ${t}`),e.playUi("ping"),d()}function d(){const t=document.getElementById("modal-overlay");t&&(t.style.display="none")}function c(){const t=document.getElementById("modal-overlay"),i=document.getElementById("modal-body");if(i){const s=Array(5).fill(`
            <div class="skeleton-diag-item">
                <div class="skeleton-diag-bar" style="height: 14px; width: 60%;"></div>
                <div class="skeleton-diag-bar" style="height: 14px; width: 15%;"></div>
            </div>
        `).join("");i.innerHTML=`
            <div class="modal-header">
              <div class="skeleton-diag-bar" style="height: 24px; width: 50%; margin-bottom: 8px;"></div>
              <div class="skeleton-diag-bar" style="height: 12px; width: 80%;"></div>
            </div>
            <div style="margin-top:20px;">${s}</div>
        `,t.style.display="flex"}{console.warn("[Security] Diagnostic access denied in production."),e.addToast("error",e.state.lang==="en"?"Access Denied":"पहुँच अस्वीकृत");return}}export{d as closeModal,c as showDiagnostics,n as showModal};
