/* =========================================================
   MEDRA Patient Dashboard Controller
   ========================================================= */

"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Guard route
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["patient", "admin"])) {
        return;
    }

    await loadDashboardData();
    setupQuickActions();
    window.setInterval(loadActiveEmergency, 10000);
});

async function loadDashboardData() {
    const api = window.MedraAPI;
    if (!api) return;

    try {
        // 1. Load Profile
        const profile = await api.get("/api/patient/profile");
        renderPatientInfo(profile);

        // 2. Check Active Emergency
        await loadActiveEmergency();

        // 3. Load Vitals
        const vitalsData = await api.get("/api/patient/vitals");
        renderVitals(vitalsData.vitals || []);

        // 4. Load Notifications
        const notifData = await api.get("/api/patient/notifications");
        renderNotifications(notifData.notifications || []);

    } catch (err) {
        console.error("Dashboard data load error:", err);
        if (typeof showNotification === "function") {
            showNotification(err.message || "Failed to load dashboard data.", "warning");
        }
    }
}

async function loadActiveEmergency() {
    try {
        const activeData = await window.MedraAPI.get("/api/patient/emergencies/active");
        renderActiveEmergency(activeData);
    } catch (err) {
        console.error("Active emergency refresh error:", err);
    }
}

function renderPatientInfo(p) {
    const nameEl = document.getElementById("welcomeName") || document.getElementById("topUserName");
    if (nameEl) nameEl.textContent = p.full_name;

    const refEl = document.getElementById("patientReferenceId");
    if (refEl) refEl.textContent = `MEDRA-PAT-${String(p.id).padStart(4, "0")}`;

    const bloodEl = document.getElementById("patientBloodGroup");
    if (bloodEl) bloodEl.textContent = p.blood_group || "Not recorded";

    const contactEl = document.getElementById("emergencyContactDisplay");
    if (contactEl) {
        contactEl.textContent = p.emergency_contact_name 
            ? `${p.emergency_contact_name} (${p.emergency_contact_mobile || "No number"})`
            : "No emergency contact set";
    }

    const abhaBadge = document.getElementById("abhaStatusBadge");
    if (abhaBadge) {
        abhaBadge.textContent = p.abha_linked ? "ABHA Linked (Demo)" : "ABHA Not Linked";
        abhaBadge.className = p.abha_linked ? "badge bg-success" : "badge bg-secondary";
    }
}

function renderActiveEmergency(activeData) {
    const banner = document.getElementById("activeEmergencyBanner");
    const statusText = document.getElementById("activeEmergencyStatus");
    const ambText = document.getElementById("activeEmergencyAmbulance");
    const hospText = document.getElementById("activeEmergencyHospital");

    if (!banner) return;

    if (activeData?.has_active && activeData.emergency) {
        const emg = activeData.emergency;
        banner.style.display = "block";
        banner.style.background = "#fff0f2";
        banner.style.border = "1px solid #ef4554";

        if (statusText) statusText.textContent = `${emg.reference}: ${emg.status} (${emg.emergency_type})`;
        if (ambText) {
            if (!emg.ambulance) {
                ambText.textContent = "Ambulance: Waiting for an eligible crew to accept";
            } else {
                const locationTime = emg.ambulance_location_updated_at
                    ? new Date(emg.ambulance_location_updated_at)
                    : null;
                const isFresh = locationTime && Number.isFinite(locationTime.getTime())
                    && Date.now() - locationTime.getTime() <= 120000;
                const locationState = isFresh
                    ? `Location updated ${locationTime.toLocaleTimeString()}`
                    : "Location unavailable or stale";
                ambText.textContent = `Ambulance: ${emg.ambulance.vehicle_number} (${emg.ambulance.driver_name}) · ${locationState}`;
            }
        }
        if (hospText) {
            hospText.textContent = emg.hospital 
                ? `Hospital Destination: ${emg.hospital.name}`
                : "Hospital: Not selected yet";
        }
    } else {
        banner.style.display = "none";
    }
}

function renderVitals(vitals) {
    if (!vitals || vitals.length === 0) return;
    const latest = vitals[0];

    const hrEl = document.getElementById("liveHeartRate");
    const bpEl = document.getElementById("liveBloodPressure");
    const spo2El = document.getElementById("liveSpo2");
    const tempEl = document.getElementById("liveTemp");

    if (hrEl && latest.heart_rate) hrEl.textContent = `${latest.heart_rate} bpm`;
    if (bpEl && latest.blood_pressure) bpEl.textContent = `${latest.blood_pressure} mmHg`;
    if (spo2El && latest.sp_o2) spo2El.textContent = `${latest.sp_o2}%`;
    if (tempEl && latest.temperature) tempEl.textContent = `${latest.temperature} °C`;
}

function renderNotifications(notifs) {
    const list = document.getElementById("dashboardNotificationList");
    if (!list) return;

    if (notifs.length === 0) {
        list.innerHTML = `<li class="list-group-item text-muted text-center py-3">No new notifications</li>`;
        return;
    }

    list.innerHTML = notifs.slice(0, 4).map(n => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
            <div>
                <strong>${n.title}</strong>
                <p class="mb-0 text-muted small">${n.message}</p>
            </div>
            <span class="badge ${n.type === 'EMERGENCY' ? 'bg-danger' : 'bg-primary'}">${n.type}</span>
        </li>
    `).join("");
}

function setupQuickActions() {
    const sosBtn = document.getElementById("dashboardSosBtn");
    if (sosBtn) {
        sosBtn.addEventListener("click", () => {
            window.location.href = "emergency.html";
        });
    }

    const logoutBtn = document.getElementById("patientLogoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", (e) => {
            e.preventDefault();
            if (typeof logoutMedra === "function") logoutMedra();
        });
    }
}
