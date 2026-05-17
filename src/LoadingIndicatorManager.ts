export class LoadingIndicatorManager {
    private syncIcon = document.getElementById("data-sync-icon"); // No citation needed, this is internal code.
    private loader = document.getElementById("loader"); // No citation needed, this is internal code.
    private offlineOverlay = document.getElementById("offline-overlay");
    private tbody = document.getElementById("tbody");
    private cardsContainer = document.getElementById("view-cards");
    private briefContainer = document.getElementById("ai-brief-text");
    private briefCard = document.getElementById("ai-brief-card");

    showLoading() {
        if (this.syncIcon) {
            this.syncIcon.style.display = "inline-block";
            this.syncIcon.classList.add("spinning");
        }

        if (this.tbody) {
            this.tbody.innerHTML = Array(10)
                .fill(`<tr class="skeleton-row"><td><div></div></td>${Array(5).fill("<td><div></div></td>").join("")}</tr>`)
                .join("");
        }

        if (this.cardsContainer) {
            this.cardsContainer.innerHTML = Array(6)
                .fill(`<div class="skeleton-card">
            <div style="height: 24px; width: 70%; margin-bottom: 20px;"></div>
            <div style="height: 12px; width: 100%; margin-bottom: 15px;"></div>
            <div style="height: 40px; width: 100%; margin-bottom: 20px;"></div>
            <div style="height: 10px; width: 90%; margin-bottom: 10px;"></div>
            <div style="height: 10px; width: 50%;"></div>
        </div>`).join("");
        }

        if (this.briefContainer) {
            this.briefContainer.innerHTML = `
        <div class="skeleton-brief-line" style="width: 100%;"></div>
        <div class="skeleton-brief-line" style="width: 90%;"></div>
        <div class="skeleton-brief-line" style="width: 95%;"></div>
      `;
            if (this.briefCard) this.briefCard.style.display = "block";
        }
    }

    hideLoading(success: boolean) {
        if (this.syncIcon) {
            this.syncIcon.classList.remove("spinning");
            this.syncIcon.style.display = "none";
        }
        if (this.loader) this.loader.style.display = "none";

        if (success) {
            if (this.offlineOverlay) this.offlineOverlay.style.display = "none";
        } else {
            if (this.offlineOverlay) this.offlineOverlay.style.display = "flex";
        }
    }

    setSyncing(isSyncing: boolean) {
        if (this.syncIcon) {
            this.syncIcon.style.display = isSyncing ? "inline-block" : "none";
            this.syncIcon.classList.toggle("spinning", isSyncing);
        }
    }
}