"use strict";

/* =========================================================
   MEDRA AMBULANCE DISPATCH TERMINAL CONTROLLER
   ========================================================= */

let mapInstance = null;
let currentMarkers = [];
let routePolyline = null;
let activeAssignmentId = null;
let dashboardLoading = false;
let availableHospitals = null;
let locationWatchId = null;
let lastLocationSentAt = 0;
let locationUpdateInFlight = false;

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["ambulance", "admin"])) {
        return;
    }

    initAmbulanceMap();
    setupAvailabilityHandler();
    setupMissionStepper();
    setupEmergencyActions();
    setupHospitalSelection();
    window.addEventListener("pagehide", stopLocationSharing);
    await loadAmbulanceDashboard();
    window.setInterval(loadAmbulanceDashboard, 10000);
});

function initAmbulanceMap() {
    const mapEl = document.getElementById("ambulanceMap");
    if (!mapEl || typeof L === "undefined") return;

    mapInstance = L.map("ambulanceMap").setView([20.5, 78.9], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors"
    }).addTo(mapInstance);
}

async function loadAmbulanceDashboard() {
    const api = window.MedraAPI;
    if (!api || dashboardLoading) return;
    dashboardLoading = true;

    try {
        const [stats, pending] = await Promise.all([
            api.get("/api/ambulance/dashboard-stats"),
            api.get("/api/ambulance/emergencies/pending")
        ]);

        // Driver details
        setElText("driverName", stats.driver_name);
        setElText("vehicleNumberDisplay", `Vehicle: ${stats.vehicle_number}`);
        setElText("completedRunsCount", stats.completed_runs);

        const availSelect = document.getElementById("availabilitySelect");
        if (availSelect && stats.status) {
            availSelect.value = stats.status;
        }

        renderMission(stats.active_assignment, stats);
        syncLocationSharing(stats.active_assignment);
        if (stats.active_assignment && !availableHospitals) {
            await loadAvailableHospitals();
            renderMission(stats.active_assignment, stats);
        }
        renderPendingEmergencies(pending.emergencies || []);
        await loadTripHistory();

    } catch (err) {
        console.error("Ambulance dashboard load error:", err);
        if (typeof showNotification === "function") {
            showNotification(err.message || "Failed to load ambulance dashboard data.", "error");
        }
    } finally {
        dashboardLoading = false;
    }
}

function renderPendingEmergencies(emergencies) {
    const container = document.getElementById("pendingEmergencyList");
    if (!container) return;
    if (!emergencies.length) {
        container.innerHTML = '<div class="text-center text-muted py-3">No pending emergencies.</div>';
        return;
    }

    container.innerHTML = emergencies.map(emergency => {
        const hasLocation = isValidCoordinates(emergency.pickup_latitude, emergency.pickup_longitude);
        const locationLink = hasLocation
            ? `<a href="https://www.openstreetmap.org/?mlat=${Number(emergency.pickup_latitude)}&mlon=${Number(emergency.pickup_longitude)}#map=16/${Number(emergency.pickup_latitude)}/${Number(emergency.pickup_longitude)}" target="_blank" rel="noopener noreferrer">Map</a>`
            : "Location unavailable";
        const createdAt = emergency.created_at && Number.isFinite(Date.parse(emergency.created_at))
            ? new Date(emergency.created_at).toLocaleString()
            : "Time unavailable";
        return `
        <article class="border rounded p-3 mb-3" data-emergency-id="${Number(emergency.id)}">
            <div class="d-flex justify-content-between gap-3 align-items-start">
                <div>
                    <strong>${escapeHtml(emergency.reference)}</strong>
                    <div class="fw-semibold mt-1">${escapeHtml(emergency.emergency_type)}</div>
                    <div class="small text-muted">${escapeHtml(emergency.patient_name || "Patient")}</div>
                </div>
                <span class="badge ${emergency.priority === "CRITICAL" ? "bg-danger" : emergency.priority === "HIGH" ? "bg-warning text-dark" : "bg-secondary"}">
                    ${escapeHtml(emergency.priority)}
                </span>
            </div>
            <p class="small text-secondary my-2">${escapeHtml(emergency.description || "No additional details provided.")}</p>
            <div class="small text-muted mb-1">Created: ${escapeHtml(createdAt)}</div>
            <div class="small text-muted mb-3">Pickup: ${formatCoordinates(emergency.pickup_latitude, emergency.pickup_longitude)} · ${locationLink}</div>
            <div class="d-flex flex-wrap align-items-center gap-2">
                <button class="btn btn-success btn-sm" data-emergency-action="accept">Accept</button>
                <button class="btn btn-outline-danger btn-sm" data-emergency-action="reject">Reject</button>
                <label class="small text-muted ms-sm-2" for="priority-${Number(emergency.id)}">Priority</label>
                <select class="form-select form-select-sm w-auto" id="priority-${Number(emergency.id)}" data-emergency-action="priority">
                    ${["LOW", "NORMAL", "HIGH", "CRITICAL"].map(priority => `<option value="${priority}" ${priority === emergency.priority ? "selected" : ""}>${priority}</option>`).join("")}
                </select>
            </div>
        </article>
    `;
    }).join("");
}

function setupEmergencyActions() {
    const container = document.getElementById("pendingEmergencyList");
    if (!container) return;

    container.addEventListener("click", async event => {
        const button = event.target.closest("button[data-emergency-action]");
        if (!button) return;
        const card = button.closest("[data-emergency-id]");
        const emergencyId = Number(card?.dataset.emergencyId);
        const action = button.dataset.emergencyAction;
        if (!emergencyId || !["accept", "reject"].includes(action)) return;
        await submitEmergencyAction(emergencyId, action, button);
    });

    container.addEventListener("change", async event => {
        const select = event.target.closest("select[data-emergency-action='priority']");
        if (!select) return;
        const card = select.closest("[data-emergency-id]");
        await submitEmergencyAction(Number(card?.dataset.emergencyId), "priority", select, select.value);
    });
}

function setupHospitalSelection() {
    const select = document.getElementById("missionHospitalSelect");
    if (!select) return;
    select.addEventListener("change", async () => {
        if (!activeAssignmentId || !select.value) return;
        const message = document.getElementById("missionHospitalSelectionMessage");
        select.disabled = true;
        if (message) message.textContent = "Saving hospital selection...";
        try {
            const result = await window.MedraAPI.patch(
                `/api/ambulance/assignment/${activeAssignmentId}/hospital`,
                { hospital_id: Number(select.value) }
            );
            if (message) message.textContent = `Selected ${result.hospital_name}.`;
            await loadAmbulanceDashboard();
        } catch (error) {
            if (message) message.textContent = error.message || "Unable to select this hospital.";
            if (typeof showNotification === "function") {
                showNotification(error.message || "Unable to select this hospital.", "error");
            }
            await loadAmbulanceDashboard();
        }
    });
}

async function loadAvailableHospitals() {
    const select = document.getElementById("missionHospitalSelect");
    if (!select) return;
    try {
        const data = await window.MedraAPI.get("/api/ambulance/hospitals");
        availableHospitals = data.hospitals || [];
        select.innerHTML = '<option value="">Select a hospital</option>' + availableHospitals.map(hospital => {
            const capacity = (hospital.capabilities || [])
                .map(item => `${item.resource_type}: ${item.available}`)
                .join(", ");
            const suffix = capacity ? ` · ${capacity}` : "";
            return `<option value="${Number(hospital.id)}">${escapeHtml(hospital.name)} — ${escapeHtml(hospital.address)}${escapeHtml(suffix)}</option>`;
        }).join("");
        select.disabled = availableHospitals.length === 0;
        if (!availableHospitals.length) {
            const message = document.getElementById("missionHospitalSelectionMessage");
            if (message) message.textContent = "No emergency-capable hospitals are currently available.";
        }
    } catch (error) {
        console.error("Hospital list load error:", error);
        const message = document.getElementById("missionHospitalSelectionMessage");
        if (message) message.textContent = error.message || "Unable to load available hospitals.";
    }
}

function syncLocationSharing(assignment) {
    const active = assignment && !["RESOLVED", "CANCELLED"].includes(assignment.status);
    if (!active) {
        stopLocationSharing();
        return;
    }
    if (locationWatchId !== null) return;

    const status = document.getElementById("ambulanceLocationStatus");
    if (!navigator.geolocation) {
        if (status) status.textContent = "This browser does not provide GPS; ambulance location is unavailable.";
        return;
    }

    if (status) status.textContent = "Requesting GPS permission for the active mission...";
    locationWatchId = navigator.geolocation.watchPosition(async position => {
        if (!activeAssignmentId || locationUpdateInFlight || Date.now() - lastLocationSentAt < 15000) return;
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);
        if (!isValidCoordinates(latitude, longitude)) return;

        locationUpdateInFlight = true;
        try {
            const response = await window.MedraAPI.patch("/api/ambulance/location", { latitude, longitude });
            lastLocationSentAt = Date.now();
            if (status) {
                status.textContent = `Ambulance GPS updated ${new Date(response.location_updated_at).toLocaleTimeString()}.`;
            }
        } catch (error) {
            if (status) status.textContent = error.message || "Unable to share ambulance GPS.";
            console.error("Ambulance location update error:", error);
        } finally {
            locationUpdateInFlight = false;
        }
    }, error => {
        if (status) {
            status.textContent = error.code === error.PERMISSION_DENIED
                ? "GPS permission was denied. Ambulance location is unavailable."
                : "Ambulance GPS is currently unavailable.";
        }
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
}

function stopLocationSharing() {
    if (locationWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchId);
    }
    locationWatchId = null;
}

async function submitEmergencyAction(emergencyId, action, control, priority) {
    if (!emergencyId || !control) return;
    const message = document.getElementById("ambulanceWorkflowMessage");
    control.disabled = true;
    if (message) message.textContent = `${action === "priority" ? "Saving priority" : `${action[0].toUpperCase()}${action.slice(1)}ing emergency`}...`;
    try {
        const api = window.MedraAPI;
        let result;
        if (action === "priority") {
            result = await api.patch(`/api/ambulance/emergencies/${emergencyId}/priority`, { priority });
        } else {
            result = await api.request(`/api/ambulance/emergencies/${emergencyId}/${action}`, { method: "POST" });
        }
        if (message) message.textContent = result.message || `Emergency ${action} completed.`;
        if (typeof showNotification === "function") showNotification(message?.textContent || "Emergency updated.", "success");
        await loadAmbulanceDashboard();
    } catch (error) {
        if (message) message.textContent = error.message || "Unable to update emergency.";
        if (typeof showNotification === "function") showNotification(error.message || "Unable to update emergency.", "error");
    } finally {
        control.disabled = false;
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
        const locationIsFresh = ambulance && isRecentLocation(ambulance.location_updated_at);
        if (ambulance && locationIsFresh && isValidCoordinates(ambulance.latitude, ambulance.longitude) && mapInstance && typeof L !== "undefined") {
            L.marker([ambulance.latitude, ambulance.longitude])
                .addTo(mapInstance)
                .bindPopup(`<b>Ambulance ${escapeHtml(ambulance.vehicle_number)}</b>`);
            mapInstance.setView([ambulance.latitude, ambulance.longitude], 14);
        }
        setElText("ambulanceLocationStatus", "Ambulance GPS sharing is stopped while there is no active mission.");
        const hospitalSelect = document.getElementById("missionHospitalSelect");
        if (hospitalSelect) hospitalSelect.disabled = true;
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
    setElText("missionPickupCoords", formatCoordinates(assignment.pickup_latitude, assignment.pickup_longitude));
    const pickupLink = document.getElementById("missionPickupMapLink");
    if (pickupLink) {
        pickupLink.innerHTML = isValidCoordinates(assignment.pickup_latitude, assignment.pickup_longitude)
            ? `<a href="https://www.openstreetmap.org/?mlat=${Number(assignment.pickup_latitude)}&mlon=${Number(assignment.pickup_longitude)}#map=16/${Number(assignment.pickup_latitude)}/${Number(assignment.pickup_longitude)}" target="_blank" rel="noopener noreferrer">Open patient location</a>`
            : "No patient coordinates were provided";
    }

    const selectedHospital = assignment.destination_hospital || assignment.hospital;
    setElText("missionHospitalName", selectedHospital?.name || "Not selected");
    setElText("missionHospitalAddress", selectedHospital?.address || "Choose an available hospital for this mission.");
    const hospitalSelect = document.getElementById("missionHospitalSelect");
    if (hospitalSelect) {
        hospitalSelect.disabled = !availableHospitals
            || !["ACCEPTED", "EN_ROUTE", "PATIENT_PICKED_UP", "HOSPITAL_SELECTED"].includes(assignment.status);
        hospitalSelect.value = selectedHospital?.id ? String(selectedHospital.id) : "";
    }

    // Highlight active status in stepper
    highlightStepperStatus(assignment.status);

    // Update Map
    updateMapForMission(ambulance, assignment);
}

function highlightStepperStatus(status) {
    const nextStatus = {
        ACCEPTED: "EN_ROUTE",
        EN_ROUTE: "PATIENT_PICKED_UP",
        HOSPITAL_ACCEPTED: "HOSPITAL_ARRIVED",
        HOSPITAL_RECEIVED: "RESOLVED"
    }[status];
    document.querySelectorAll(".mission-step-btn").forEach(btn => {
        const target = btn.getAttribute("data-status");
        if (target === status) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
        btn.disabled = target !== nextStatus;
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

    const hasAmbulanceLocation = amb
        && isValidCoordinates(amb.latitude, amb.longitude)
        && isRecentLocation(amb.location_updated_at);
    const hasPickupLocation = isValidCoordinates(mission.pickup_latitude, mission.pickup_longitude);
    const ambLat = hasAmbulanceLocation ? Number(amb.latitude) : null;
    const ambLng = hasAmbulanceLocation ? Number(amb.longitude) : null;
    const pickLat = mission.pickup_latitude;
    const pickLng = mission.pickup_longitude;
    const hospital = mission.destination_hospital || mission.hospital;
    const hasHospitalLocation = hospital && isValidCoordinates(hospital.latitude, hospital.longitude);
    const hospLat = hasHospitalLocation ? Number(hospital.latitude) : null;
    const hospLng = hasHospitalLocation ? Number(hospital.longitude) : null;
    const points = [];

    if (hasAmbulanceLocation) {
        const ambMarker = L.marker([ambLat, ambLng])
            .addTo(mapInstance)
            .bindPopup(`<b>Ambulance Unit</b><br>${escapeHtml(amb.vehicle_number)}`);
        currentMarkers.push(ambMarker);
        points.push([ambLat, ambLng]);
    }

    if (hasPickupLocation) {
        const pickMarker = L.marker([Number(pickLat), Number(pickLng)])
            .addTo(mapInstance)
            .bindPopup(`<b>Patient Pickup Location</b><br>${escapeHtml(mission.patient_name)}<br>${escapeHtml(mission.patient_phone)}`);
        currentMarkers.push(pickMarker);
        points.push([Number(pickLat), Number(pickLng)]);
    }

    if (hasHospitalLocation) {
        const hospMarker = L.marker([hospLat, hospLng])
            .addTo(mapInstance)
            .bindPopup(`<b>Hospital Destination</b><br>${escapeHtml(hospital.name)}`);
        currentMarkers.push(hospMarker);
        points.push([hospLat, hospLng]);
    }

    if (points.length > 1) {
        routePolyline = L.polyline(points, { color: "#ef4554", weight: 4, dashArray: "6, 8" }).addTo(mapInstance);
        mapInstance.fitBounds(points, { padding: [40, 40] });
    } else if (points.length === 1) {
        mapInstance.setView(points[0], 14);
    }

    const locationStatus = document.getElementById("ambulanceLocationStatus");
    if (locationStatus) {
        locationStatus.textContent = hasAmbulanceLocation
            ? `Ambulance GPS updated ${new Date(amb.location_updated_at).toLocaleTimeString()}.`
            : "Ambulance GPS is unavailable or stale; only reported patient and hospital coordinates are shown.";
    }
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
            if (typeof showNotification === "function") showNotification(e.message || "Unable to update availability.", "error");
            const stats = await window.MedraAPI.get("/api/ambulance/dashboard-stats").catch(() => null);
            if (stats?.status) sel.value = stats.status;
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

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function formatCoordinates(latitude, longitude) {
    if (!isValidCoordinates(latitude, longitude)) return "Location not provided";
    return `${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}`;
}

function isValidCoordinates(latitude, longitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    return latitude != null && longitude != null
        && Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function isRecentLocation(timestamp) {
    const updatedAt = Date.parse(timestamp || "");
    const age = Date.now() - updatedAt;
    return Number.isFinite(updatedAt) && age >= 0 && age <= 120000;
}
