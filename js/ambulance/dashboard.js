"use strict";

/* =========================================================
   MEDRA AMBULANCE DISPATCH TERMINAL CONTROLLER
   ========================================================= */

let mapInstance = null;
let currentMarkers = [];
let routePolyline = null;
let activeAssignmentId = null;

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["ambulance", "admin"])) {
        return;
    }

    initAmbulanceMap();
    setupAvailabilityHandler();
    setupMissionStepper();
    await loadAmbulanceDashboard();
});

function initAmbulanceMap() {
    const mapEl = document.getElementById("ambulanceMap");
    if (!mapEl || typeof L === "undefined") return;

    mapInstance = L.map("ambulanceMap").setView([17.6599, 75.9064], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors"
    }).addTo(mapInstance);
}

async function loadAmbulanceDashboard() {
    const api = window.MedraAPI;
    if (!api) return;

    try {
        const stats = await api.get("/api/ambulance/dashboard-stats");

        // Driver details
        setElText("driverName", stats.driver_name);
        setElText("vehicleNumberDisplay", `Vehicle: ${stats.vehicle_number}`);
        setElText("completedRunsCount", stats.completed_runs);

        const availSelect = document.getElementById("availabilitySelect");
        if (availSelect && stats.status) {
            availSelect.value = stats.status;
        }

        renderMission(stats.active_assignment, stats);
        await loadTripHistory();

    } catch (err) {
        console.error("Ambulance dashboard load error:", err);
        if (typeof showNotification === "function") {
            showNotification(err.message || "Failed to load ambulance dashboard data.", "error");
        }
    }
}

function renderMission(assignment, ambulance) {
    const noPrompt = document.getElementById("noMissionPrompt");
    const details = document.getElementById("activeMissionDetails");
    const badge = document.getElementById("assignmentStatusBadge");

    if (!assignment) {
        activeAssignmentId = null;
        if (noPrompt) noPrompt.style.display = "block";
        if (details) details.style.display = "none";
        if (badge) {
            badge.textContent = "STANDBY / AVAILABLE";
            badge.className = "badge bg-success px-3 py-2";
        }
        clearMapMarkers();
        // Just show ambulance location
        if (ambulance && mapInstance && typeof L !== "undefined") {
            L.marker([ambulance.latitude, ambulance.longitude])
                .addTo(mapInstance)
                .bindPopup(`<b>Ambulance ${ambulance.vehicle_number}</b><br>Stationed in Solapur Central`);
            mapInstance.setView([ambulance.latitude, ambulance.longitude], 14);
        }
        return;
    }

    activeAssignmentId = assignment.assignment_id;
    if (noPrompt) noPrompt.style.display = "none";
    if (details) details.style.display = "block";

    if (badge) {
        badge.textContent = assignment.status;
        badge.className = "badge bg-danger px-3 py-2";
    }

    setElText("missionReference", assignment.reference || "MEDRA-EMG-ACTIVE");
    setElText("missionPatientName", assignment.patient_name);
    setElText("missionPatientPhone", assignment.patient_phone);
    setElText("missionDescription", `${assignment.emergency_type}: ${assignment.description || 'Emergency dispatched'}`);
    setElText("missionPickupCoords", `${assignment.pickup_latitude.toFixed(4)}, ${assignment.pickup_longitude.toFixed(4)}`);

    if (assignment.destination_hospital) {
        setElText("missionHospitalName", assignment.destination_hospital.name);
        setElText("missionHospitalAddress", assignment.destination_hospital.address);
    }

    // Highlight active status in stepper
    highlightStepperStatus(assignment.status);

    // Update Map
    updateMapForMission(ambulance, assignment);
}

function highlightStepperStatus(status) {
    document.querySelectorAll(".mission-step-btn").forEach(btn => {
        const target = btn.getAttribute("data-status");
        if (target === status) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

function clearMapMarkers() {
    currentMarkers.forEach(m => m.remove());
    currentMarkers = [];
    if (routePolyline) {
        routePolyline.remove();
        routePolyline = null;
    }
}

function updateMapForMission(amb, mission) {
    if (!mapInstance || typeof L === "undefined") return;
    clearMapMarkers();

    const ambLat = amb.latitude || 17.6586;
    const ambLng = amb.longitude || 75.9046;
    const pickLat = mission.pickup_latitude;
    const pickLng = mission.pickup_longitude;
    const hospLat = mission.destination_hospital?.latitude || 17.6625;
    const hospLng = mission.destination_hospital?.longitude || 75.9110;

    // Ambulance Marker
    const ambMarker = L.marker([ambLat, ambLng])
        .addTo(mapInstance)
        .bindPopup(`<b>🚑 Ambulance Unit</b><br>${amb.vehicle_number}`);
    currentMarkers.push(ambMarker);

    // Pickup Marker
    const pickMarker = L.marker([pickLat, pickLng])
        .addTo(mapInstance)
        .bindPopup(`<b>📍 Patient Pickup Location</b><br>${mission.patient_name}<br>Phone: ${mission.patient_phone}`);
    currentMarkers.push(pickMarker);

    // Hospital Marker
    const hospMarker = L.marker([hospLat, hospLng])
        .addTo(mapInstance)
        .bindPopup(`<b>🏥 Hospital Destination</b><br>${mission.destination_hospital?.name}`);
    currentMarkers.push(hospMarker);

    // Route polyline
    const points = [[ambLat, ambLng], [pickLat, pickLng], [hospLat, hospLng]];
    routePolyline = L.polyline(points, { color: "#ef4554", weight: 4, dashArray: "6, 8" }).addTo(mapInstance);

    mapInstance.fitBounds(points, { padding: [40, 40] });
}

function setupMissionStepper() {
    document.querySelectorAll(".mission-step-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            if (!activeAssignmentId) {
                alert("No active assignment to advance.");
                return;
            }

            const newStatus = btn.getAttribute("data-status");
            btn.disabled = true;

            try {
                const api = window.MedraAPI;
                const resp = await api.patch(`/api/ambulance/assignment/${activeAssignmentId}/status`, {
                    status: newStatus,
                    notes: `Advanced by paramedic driver to ${newStatus}`
                });

                if (typeof showNotification === "function") {
                    showNotification(`Mission status updated to ${newStatus} in PostgreSQL`, "success");
                }

                await loadAmbulanceDashboard();

            } catch (err) {
                console.error("Mission update error:", err);
                alert(err.message || "Unable to advance mission status.");
            } finally {
                btn.disabled = false;
            }
        });
    });
}

function setupAvailabilityHandler() {
    const sel = document.getElementById("availabilitySelect");
    if (!sel) return;

    sel.addEventListener("change", async () => {
        const status = sel.value;
        try {
            const api = window.MedraAPI;
            await api.patch("/api/ambulance/availability", { status });
            if (typeof showNotification === "function") {
                showNotification(`Ambulance availability set to ${status}`, "info");
            }
        } catch (e) {
            console.error("Availability update error:", e);
        }
    });
}

async function loadTripHistory() {
    const tbody = document.getElementById("ambulanceHistoryBody");
    if (!tbody) return;

    try {
        const api = window.MedraAPI;
        const data = await api.get("/api/ambulance/history");
        const list = data.history || [];

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No recorded emergency trips yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(t => `
            <tr>
                <td><strong>${t.reference}</strong></td>
                <td>${t.emergency_type}</td>
                <td>${t.destination}</td>
                <td><span class="badge ${t.status === 'COMPLETED' ? 'bg-success' : 'bg-primary'}">${t.status}</span></td>
                <td>${t.assigned_at ? new Date(t.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
            </tr>
        `).join("");

    } catch (e) {
        console.error("Trip history load error:", e);
    }
}

function setElText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text !== undefined ? text : "-";
}
