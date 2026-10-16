"use strict";

/* ==========================================
   MEDRA HOSPITAL DASHBOARD CONTROLLER
   ========================================== */

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["hospital", "admin"])) {
        return;
    }

    setupMobileSidebar();
    setupThemeManager();
    setupRefreshButton();
    await loadHospitalDashboardData();
});

async function loadHospitalDashboardData() {
    const api = window.MedraAPI;
    if (!api) return;

    try {
        const data = await api.get("/api/hospital/dashboard-stats");

        // Staff profile
        const nameEl = document.getElementById("hospitalName");
        const roleEl = document.getElementById("hospitalRole");
        if (nameEl) nameEl.textContent = data.staff_name;
        if (roleEl) roleEl.textContent = `Hospital Staff · ${data.hospital_name}`;

        // Metrics
        const m = data.metrics || {};
        setElementText("totalPatientsCount", m.total_registered_patients);
        setElementText("pendingVerificationCount", m.pending_verifications);
        setElementText("activeEmergencyCount", m.active_emergencies);
        setElementText("emergencyBadge", m.active_emergencies);
        setElementText("availableBedsCount", m.available_beds);
        setElementText("occupiedBedsCount", m.occupied_beds);
        setElementText("totalBedsCount", m.total_beds);

        // Recent Arrivals Table
        renderArrivalsTable(data.recent_arrivals || []);

    } catch (err) {
        console.error("Hospital dashboard load error:", err);
        if (typeof showNotification === "function") {
            showNotification(err.message || "Failed to load hospital statistics.", "warning");
        }
    }
}

function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text !== undefined ? text : "-";
}

function renderArrivalsTable(arrivals) {
    const tbody = document.getElementById("emergencyTableBody") || document.querySelector("table tbody");
    if (!tbody) return;

    if (arrivals.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No active emergency arrivals at this time.</td></tr>`;
        return;
    }

    tbody.innerHTML = arrivals.map(a => `
        <tr>
            <td><strong>${a.reference}</strong></td>
            <td>${a.type}</td>
            <td><span class="badge ${a.priority === 'Critical' ? 'bg-danger' : 'bg-warning text-dark'}">${a.priority}</span></td>
            <td><span class="badge bg-info text-dark">${a.status}</span></td>
            <td>${a.ambulance}</td>
        </tr>
    `).join("");
}

function setupRefreshButton() {
    const btn = document.getElementById("refreshDashboard");
    if (btn) {
        btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.textContent = "Syncing with PostgreSQL...";
            await loadHospitalDashboardData();
            btn.disabled = false;
            btn.textContent = "Refresh";
            if (typeof showNotification === "function") {
                showNotification("Hospital dashboard data synchronized with PostgreSQL", "success");
            }
        });
    }
}

function setupMobileSidebar() {
    const menuButton = document.getElementById("hospitalMenuButton");
    const sidebar = document.querySelector(".hospital-sidebar");

    if (menuButton && sidebar) {
        menuButton.addEventListener("click", () => {
            const isOpen = sidebar.classList.toggle("open");
            menuButton.setAttribute("aria-expanded", String(isOpen));
        });

        sidebar.querySelectorAll("a.hospital-nav-link").forEach((link) => {
            link.addEventListener("click", () => {
                sidebar.classList.remove("open");
                menuButton.setAttribute("aria-expanded", "false");
            });
        });
    }

    // Mark active link
    const current = window.location.pathname.split("/").pop();
    document.querySelectorAll(".hospital-navigation .hospital-nav-link").forEach(link => {
        const href = (link.getAttribute("href") || "").split("/").pop();
        if (href === current) {
            link.classList.add("active");
            link.setAttribute("aria-current", "page");
        }
    });
}

function setupThemeManager() {
    const themeSelect = document.getElementById("hospitalThemeSelect");
    if (themeSelect) {
        themeSelect.value = localStorage.getItem("medra_theme") || "system";
        themeSelect.addEventListener("change", () => {
            if (typeof applyTheme === "function") {
                applyTheme(themeSelect.value);
            }
        });
    }
}