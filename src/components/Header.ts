export class Header {
  constructor(dashboard) {
    this.dashboard = dashboard;
    this.init();
  }

  init() {
    console.log("⚓ Header Component Initialized");
    this.setupSearch();
    this.setupLanguageToggle();
  }

  setupSearch() {
    const searchInput = document.getElementById("search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        this.dashboard.handleSearch(query);
      });
    }
  }

  setupLanguageToggle() {
    const langBtn = document.querySelector(".lang-btn-group");
    if (langBtn) {
      langBtn.addEventListener("click", () => {
        this.dashboard.toggleLang();
      });
    }
  }

  updateStatus(status, color = "white") {
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.innerText = status;
      statusEl.style.color = color;
    }
  }

  setLoading(isLoading) {
    const icon = document.getElementById("data-sync-icon");
    if (icon) {
      icon.style.display = isLoading ? "inline-block" : "none";
    }
  }
}
