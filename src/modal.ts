import { Dashboard } from "./Dashboard.js";

export function showModal(indicatorName: string, _dashboard: Dashboard) {
  console.log("Showing modal for:", indicatorName);
}

export function closeModal() {
  const overlay = document.getElementById("modal-overlay");
  if (overlay) overlay.style.display = "none";
}