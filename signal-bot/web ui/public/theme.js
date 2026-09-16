"use strict";
// Apply the saved theme before CSS paints. Dark is the initial preference.
try {
  const saved = localStorage.getItem("signal-lab-theme");
  document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}
