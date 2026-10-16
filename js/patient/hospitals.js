/* =========================================================
   MEDRA - PATIENT HOSPITALS DIRECTORY & MAP
   ========================================================= */

"use strict";

let hospitalMap = null;
let hospitalMarkers = [];

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["patient", "admin"])) {
        return;
    }

    initMap();
    await loadHospitals();
});

function initMap() {
    const mapEl = document.getElementById("hospitalMap");
    if (!mapEl || typeof L === "undefined") return;

    hospitalMap = L.map("hospitalMap").setView([17.6599, 75.9064], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors"
    }).addTo(hospitalMap);
}

async function loadHospitals() {
    const listContainer = document.getElementById("hospitalList") || document.querySelector(".hospital-grid");
    const api = window.MedraAPI;
    if (!api) return;

    try {
        const data = await api.get("/api/patient/hospitals");
        const hospitals = data.hospitals || [];

        renderHospitalCards(hospitals, listContainer);
        plotHospitalMarkers(hospitals);

    } catch (err) {
        console.error("Hospitals load error:", err);
        if (typeof showNotification === "function") {
            showNotification(err.message || "Failed to load hospitals.", "error");
        }
    }
}

function renderHospitalCards(hospitals, container) {
    if (!container) return;

    if (hospitals.length === 0) {
        container.innerHTML = `<div class="text-muted p-4 text-center">No hospitals registered yet.</div>`;
        return;
    }

    container.innerHTML = hospitals.map(h => {
        const bedInfo = h.resources && h.resources.length > 0 
            ? h.resources.map(r => `<span class="badge bg-light text-dark border me-1">${r.resource_type}: ${r.available}/${r.total} free</span>`).join("")
            : `<span class="badge bg-success">Trauma Ready</span>`;

        return `
            <div class="card p-3 mb-3 shadow-sm border-0 hospital-item" style="cursor:pointer;" onclick="focusHospital(${h.latitude}, ${h.longitude}, '${h.name.replace(/'/g, "\\'")}')">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h5 class="mb-1 text-primary">${h.name}</h5>
                        <p class="mb-1 text-muted small"><i class="bi bi-geo-alt"></i> ${h.address}</p>
                        <p class="mb-2 text-secondary small"><i class="bi bi-telephone"></i> Emergency: <b>${h.phone}</b></p>
                    </div>
                    <span class="badge ${h.emergency_available ? 'bg-success' : 'bg-danger'}">
                        ${h.emergency_available ? 'ER Available' : 'ER Full'}
                    </span>
                </div>
                <div class="mt-2 pt-2 border-top">
                    <small class="text-muted d-block mb-1">Live Resource Capacity:</small>
                    <div class="d-flex flex-wrap gap-1">${bedInfo}</div>
                </div>
            </div>
        `;
    }).join("");
}

function plotHospitalMarkers(hospitals) {
    if (!hospitalMap || typeof L === "undefined") return;

    // Clear existing
    hospitalMarkers.forEach(m => m.remove());
    hospitalMarkers = [];

    const group = [];

    hospitals.forEach(h => {
        const marker = L.marker([h.latitude, h.longitude])
            .addTo(hospitalMap)
            .bindPopup(`
                <b>${h.name}</b><br>
                ${h.address}<br>
                Emergency Phone: ${h.phone}<br>
                <b>Status: ${h.emergency_available ? 'Ready for Admissions' : 'Diverting'}</b>
            `);

        hospitalMarkers.push(marker);
        group.push([h.latitude, h.longitude]);
    });

    if (group.length > 0) {
        hospitalMap.fitBounds(group, { padding: [50, 50] });
    }
}

function focusHospital(lat, lng, name) {
    if (hospitalMap) {
        hospitalMap.setView([lat, lng], 15);
        const match = hospitalMarkers.find(m => {
            const p = m.getLatLng();
            return Math.abs(p.lat - lat) < 0.0001 && Math.abs(p.lng - lng) < 0.0001;
        });
        if (match) match.openPopup();
    }
}
window.focusHospital = focusHospital;