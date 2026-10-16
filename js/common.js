/* =========================================================
   MEDRA Common UI, Theme & Session Helpers
   ========================================================= */

"use strict";

// Theme Support (Light, Dark, System)
function initTheme() {
    const saved = localStorage.getItem("medra_theme") || "system";
    applyTheme(saved);
}

function applyTheme(theme) {
    const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) {
        document.body.classList.add("dark");
        document.documentElement.setAttribute("data-theme", "dark");
    } else {
        document.body.classList.remove("dark");
        document.documentElement.setAttribute("data-theme", "light");
    }
    localStorage.setItem("medra_theme", theme);

    // Update buttons
    const btns = document.querySelectorAll(".theme, #themeButton");
    btns.forEach(btn => {
        btn.textContent = isDark ? "☀️ Light" : "☾ Dark";
    });
}

function toggleTheme() {
    const current = localStorage.getItem("medra_theme") || "system";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
}

// Toast Notifications
function showNotification(message, type = "info") {
    let container = document.getElementById("medraToastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "medraToastContainer";
        container.style.cssText = "position:fixed; bottom:24px; right:24px; z-index:99999; display:flex; flex-direction:column; gap:10px;";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    const colors = {
        success: { bg: "#06b878", text: "#fff" },
        error: { bg: "#ef4554", text: "#fff" },
        warning: { bg: "#f59e0b", text: "#fff" },
        info: { bg: "#00a8c8", text: "#fff" }
    };
    const c = colors[type] || colors.info;

    toast.style.cssText = `
        background: ${c.bg};
        color: ${c.text};
        padding: 12px 20px;
        border-radius: 10px;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 8px 25px rgba(0,0,0,0.2);
        opacity: 0;
        transform: translateY(20px);
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        max-width: 360px;
        line-height: 1.4;
    `;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-10px)";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// User Header Display Sync
async function syncUserDisplay() {
    const user = window.MedraAPI ? window.MedraAPI.getCurrentUser() : null;
    const token = window.MedraAPI ? window.MedraAPI.getToken() : null;

    if (!user && !token) return;

    let fullName = user ? user.full_name : "User";
    let role = user ? user.role : "";

    // Attempt live sync from backend
    if (token && window.MedraAPI) {
        try {
            const me = await window.MedraAPI.get("/api/auth/me");
            fullName = me.full_name;
            role = me.role;
            window.MedraAPI.setAuthSession(token, me);
        } catch (e) {
            // Use cached data
        }
    }

    const initial = fullName.charAt(0).toUpperCase();

    // Populate common ID selectors
    const sidebarName = document.getElementById("sidebarUserName");
    const topName = document.getElementById("topUserName");
    const sidebarAvatar = document.getElementById("sidebarAvatar");
    const topAvatar = document.getElementById("topAvatar");
    const patientName = document.getElementById("patientName");
    const hospitalName = document.getElementById("hospitalName");
    const hospitalRole = document.getElementById("hospitalRole");
    const driverName = document.getElementById("driverName");
    const adminName = document.getElementById("adminName");

    if (sidebarName) sidebarName.textContent = fullName;
    if (topName) topName.textContent = fullName;
    if (patientName) patientName.textContent = fullName;
    if (sidebarAvatar) sidebarAvatar.textContent = initial;
    if (topAvatar) topAvatar.textContent = initial;

    if (hospitalName && role === "hospital") hospitalName.textContent = fullName;
    if (hospitalRole && role === "hospital") hospitalRole.textContent = "Hospital Staff / Doctor";

    if (driverName) driverName.textContent = fullName;
    if (adminName) adminName.textContent = fullName;
}

// Role Guard
function requireRoleAuth(allowedRoles) {
    const token = window.MedraAPI ? window.MedraAPI.getToken() : null;
    const user = window.MedraAPI ? window.MedraAPI.getCurrentUser() : null;

    if (!token || !user) {
        // Find relative path to login.html
        const depth = window.location.pathname.split("/").length - 2;
        const prefix = depth > 1 ? "../../" : "../";
        window.location.href = `${prefix}pages/auth/login.html`;
        return false;
    }

    if (allowedRoles && !allowedRoles.includes(user.role)) {
        alert(`Access Restricted: This page requires ${allowedRoles.join(" or ")} account.`);
        return false;
    }

    return true;
}

// Global Logout
function logoutMedra() {
    if (window.MedraAPI) {
        window.MedraAPI.post("/api/auth/logout").catch(() => {});
        window.MedraAPI.clearAuthSession();
    }
    const currentPath = window.location.pathname;
    let target = "../auth/login.html";
    if (currentPath.includes("/pages/patient/") || currentPath.includes("/pages/hospital/") || currentPath.includes("/pages/ambulance/") || currentPath.includes("/pages/admin/")) {
        target = "../auth/login.html";
    } else if (currentPath.includes("/pages/auth/")) {
        target = "login.html";
    } else {
        target = "pages/auth/login.html";
    }
    window.location.href = target;
}

document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    syncUserDisplay();
});