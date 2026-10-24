/* =========================================================
   MEDRA Common UI, Theme & Session Helpers
   ========================================================= */

"use strict";

// Theme Support (Light, Dark, System)
function initTheme() {
    const saved = localStorage.getItem("medra_theme") || "light";
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

async function syncPatientNotificationBadges() {
    const user = window.MedraAPI?.getCurrentUser?.();
    if (user?.role !== "patient" || !window.MedraAPI) return;

    try {
        const data = await window.MedraAPI.get("/api/patient/notifications");
        const count = Number(data?.unread_count) || 0;
        document.querySelectorAll(".notification-count, .top-notification-dot").forEach(badge => {
            badge.textContent = String(count);
            badge.hidden = count === 0;
        });
    } catch (error) {
        console.error("Unable to update notification badges:", error);
    }
}

function setupAmbulanceAssignmentBanner() {
    const user = window.MedraAPI?.getCurrentUser?.();
    if (user?.role !== "ambulance") return;
    const main = document.querySelector("main");
    if (!main) return;

    let banner = document.getElementById("medraAssignmentSummary");
    if (!banner) {
        banner = document.createElement("section");
        banner.className = "medra-assignment-summary";
        banner.id = "medraAssignmentSummary";
        banner.setAttribute("aria-live", "polite");
        banner.innerHTML = '<strong>Assigned Emergency</strong><span>Loading assignment status…</span>';
        main.prepend(banner);
    }

    let loading = false;
    const refresh = async () => {
        if (loading) return;
        loading = true;
        try {
            let unit;
            let assignment;
            if (user.ambulance_subrole === "EV_DOCTOR") {
                const response = await window.MedraAPI.get("/api/ambulance/doctor/emergencies");
                unit = response.unit;
                assignment = response.emergencies?.[0] || null;
            } else {
                const response = await window.MedraAPI.get("/api/ambulance/dashboard-stats");
                unit = response;
                assignment = response.active_assignment;
            }

            if (!assignment) {
                banner.querySelector("strong").textContent = "No active emergency assigned";
                banner.querySelector("span").textContent =
                    unit?.vehicle_number ? `Vehicle ${unit.vehicle_number} · ${unit.status || "Status unavailable"}` : "Waiting for an assignment.";
                return;
            }
            const type = assignment.emergency_type || "Emergency type unavailable";
            const priority = assignment.priority || "Priority unavailable";
            const status = assignment.assignment_status || assignment.status || "Status unavailable";
            const id = assignment.reference || (assignment.emergency_id
                ? `MEDRA-EMG-${String(assignment.emergency_id).padStart(4, "0")}`
                : "ID unavailable");
            const vehicle = unit?.vehicle_number ? ` · Vehicle ${unit.vehicle_number}` : "";
            banner.querySelector("strong").textContent = `Assigned Emergency · ${type}`;
            banner.querySelector("span").textContent =
                `${priority} priority · ${status} · ${id}${vehicle}`;
        } catch (error) {
            banner.querySelector("strong").textContent = "Assignment status unavailable";
            banner.querySelector("span").textContent = error.message || "Unable to refresh emergency assignment.";
            console.error("Unable to load ambulance assignment summary:", error);
        } finally {
            loading = false;
        }
    };
    refresh();
    window.setInterval(refresh, 10000);
}

function getAccountPageUrl(page) {
    const path = window.location.pathname.replace(/\\/g, "/");
    const pagesIndex = path.indexOf("/pages/");
    const root = pagesIndex >= 0 ? path.slice(0, pagesIndex + 1) : "/";
    return `${root}pages/account/${page}.html`;
}

function setupAccountDropdown() {
    const user = window.MedraAPI?.getCurrentUser?.();
    const header = document.querySelector(".topbar-right") ||
        document.querySelector(".ec-driver-topbar") ||
        document.querySelector("header");
    if (!user || !header || document.getElementById("medraAccountDropdown")) return;

    const dropdown = document.createElement("div");
    dropdown.className = "medra-account-dropdown";
    dropdown.id = "medraAccountDropdown";
    dropdown.innerHTML = `
        <button type="button" class="medra-account-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="medraAccountMenu">
            <span class="medra-account-avatar" aria-hidden="true"></span>
            <span class="medra-account-trigger-text"><strong></strong><small></small></span>
            <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
        <div class="medra-account-menu" id="medraAccountMenu" role="menu" hidden>
            <div class="medra-account-summary">
                <strong></strong>
                <span></span>
            </div>
            <a role="menuitem" href="${getAccountPageUrl("profile")}"><i class="bi bi-person-gear"></i> Profile Update</a>
            <a role="menuitem" href="${getAccountPageUrl("settings")}"><i class="bi bi-gear"></i> Account Settings</a>
            <button type="button" role="menuitem" class="medra-account-logout"><i class="bi bi-box-arrow-right"></i> Log Out</button>
        </div>`;

    const name = String(user.full_name || "User");
    const roles = {
        patient: "Patient",
        hospital: "Hospital Staff",
        ambulance: user.ambulance_subrole
            ? `Ambulance Crew · ${String(user.ambulance_subrole).replace(/_/g, " ")}`
            : "Ambulance Crew",
        admin: "Administrator"
    };
    const role = roles[user.role] || String(user.role || "Account").replace(/_/g, " ");
    dropdown.querySelector(".medra-account-avatar").textContent = name.trim().charAt(0).toUpperCase();
    dropdown.querySelector(".medra-account-trigger-text strong").textContent = name;
    dropdown.querySelector(".medra-account-trigger-text small").textContent = role;
    dropdown.querySelector(".medra-account-summary strong").textContent = name;
    dropdown.querySelector(".medra-account-summary span").textContent = role;

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/css/account-menu.css";
    document.head.appendChild(stylesheet);
    header.appendChild(dropdown);

    const trigger = dropdown.querySelector(".medra-account-trigger");
    const menu = dropdown.querySelector(".medra-account-menu");
    const close = () => {
        menu.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
    };
    trigger.addEventListener("click", () => {
        const isOpen = !menu.hidden;
        menu.hidden = isOpen;
        trigger.setAttribute("aria-expanded", String(!isOpen));
    });
    dropdown.querySelector(".medra-account-logout").addEventListener("click", () => {
        if (typeof window.logoutMedra === "function") window.logoutMedra();
        else window.MedraAPI?.clearAuthSession?.();
    });
    document.addEventListener("click", event => {
        if (!dropdown.contains(event.target)) close();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            close();
            trigger.focus();
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    syncUserDisplay();
    syncPatientNotificationBadges();
    setupAmbulanceAssignmentBanner();
    setupAccountDropdown();

    const notificationButton = document.getElementById("notificationButton");
    if (notificationButton && window.MedraAPI?.getCurrentUser?.()?.role === "patient") {
        notificationButton.addEventListener("click", () => {
            window.location.href = new URL("notifications.html", window.location.href).href;
        });
    }
});

window.addEventListener("pageshow", event => {
    if (!event.persisted || window.MedraAPI?.getToken?.()) return;
    const path = window.location.pathname.replace(/\\/g, "/");
    if (!path.includes("/pages/account/") && !path.includes("/pages/patient/") &&
        !path.includes("/pages/hospital/") && !path.includes("/pages/ambulance/") &&
        !path.includes("/pages/admin/")) return;
    const pagesIndex = path.indexOf("/pages/");
    const root = pagesIndex >= 0 ? path.slice(0, pagesIndex + 1) : "/";
    window.location.replace(`${root}pages/auth/login.html`);
});