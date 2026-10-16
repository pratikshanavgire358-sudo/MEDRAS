/* =========================================================
   MEDRA PATIENT - EMERGENCY SOS CONTROLLER
   ========================================================= */

"use strict";

let currentCoordinates = {
    latitude: 17.6599,
    longitude: 75.9064,
    source: "Solapur Default Coordinates"
};

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["patient", "admin"])) {
        return;
    }

    setupSOSModal();
    setupLocationDetection();
    await loadEmergencyHistory();
});

function setupLocationDetection() {
    const locStatus = document.getElementById("locationStatus") || document.getElementById("gpsStatus");
    const manualLat = document.getElementById("manualLatitude");
    const manualLng = document.getElementById("manualLongitude");

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                currentCoordinates.latitude = parseFloat(pos.coords.latitude.toFixed(6));
                currentCoordinates.longitude = parseFloat(pos.coords.longitude.toFixed(6));
                currentCoordinates.source = "Device GPS Approved";
                if (locStatus) {
                    locStatus.textContent = `GPS Detected: ${currentCoordinates.latitude}, ${currentCoordinates.longitude}`;
                    locStatus.className = "text-success small";
                }
                if (manualLat) manualLat.value = currentCoordinates.latitude;
                if (manualLng) manualLng.value = currentCoordinates.longitude;
            },
            (err) => {
                console.warn("Geolocation fallback to Solapur default:", err.message);
                if (locStatus) {
                    locStatus.textContent = `GPS not granted. Using emergency center default: ${currentCoordinates.latitude}, ${currentCoordinates.longitude}`;
                    locStatus.className = "text-muted small";
                }
                if (manualLat) manualLat.value = currentCoordinates.latitude;
                if (manualLng) manualLng.value = currentCoordinates.longitude;
            },
            { timeout: 6000 }
        );
    }
}

function setupSOSModal() {
    const sendButton = document.getElementById("sendSOSButton");
    const modal = document.getElementById("sosModal");
    const cancel = document.getElementById("cancelSOS");
    const confirm = document.getElementById("confirmSOS");

    if (sendButton && modal) {
        sendButton.addEventListener("click", () => {
            const type = document.getElementById("emergencyType")?.value;
            if (!type) {
                if (typeof showNotification === "function") {
                    showNotification("Please select an emergency category first.", "warning");
                } else {
                    alert("Please select the emergency type.");
                }
                return;
            }
            modal.classList.add("show");
            modal.style.display = "flex";
        });
    }

    if (cancel && modal) {
        cancel.addEventListener("click", () => {
            modal.classList.remove("show");
            modal.style.display = "none";
        });
    }

    if (confirm) {
        confirm.addEventListener("click", submitRealEmergency);
    }
}

async function submitRealEmergency() {
    const modal = document.getElementById("sosModal");
    const confirmBtn = document.getElementById("confirmSOS");
    const typeSelect = document.getElementById("emergencyType");
    const descInput = document.getElementById("emergencyDescription");
    const stateEl = document.getElementById("emergencyState");
    const resultCard = document.getElementById("sosResultCard");

    const manualLat = document.getElementById("manualLatitude");
    const manualLng = document.getElementById("manualLongitude");

    const lat = (manualLat && manualLat.value) ? parseFloat(manualLat.value) : currentCoordinates.latitude;
    const lng = (manualLng && manualLng.value) ? parseFloat(manualLng.value) : currentCoordinates.longitude;

    const emergency_type = typeSelect ? typeSelect.value : "General Medical Emergency";
    const description = descInput ? descInput.value.trim() : "";

    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Broadcasting Emergency SOS...";
    }

    try {
        const api = window.MedraAPI;
        const resp = await api.post("/api/patient/emergency", {
            emergency_type,
            description,
            latitude: lat,
            longitude: lng
        });

        if (modal) {
            modal.classList.remove("show");
            modal.style.display = "none";
        }

        if (stateEl) {
            stateEl.textContent = `Active Emergency: ${resp.reference} (${resp.status})`;
            stateEl.style.background = "#fff0f2";
            stateEl.style.color = "#d63848";
        }

        if (typeof showNotification === "function") {
            showNotification(`🚨 Emergency ${resp.reference} created! Dispatched: ${resp.ambulance ? resp.ambulance.vehicle_number : 'Assigned'}.`, "success");
        }

        displayActiveResult(resp);
        await loadEmergencyHistory();

    } catch (err) {
        console.error("SOS submission error:", err);
        if (typeof showNotification === "function") {
            showNotification(err.message || "Failed to dispatch SOS. Please try manual emergency phone.", "error");
        } else {
            alert(err.message || "Emergency submission failed.");
        }
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = "Confirm SOS";
        }
    }
}

function displayActiveResult(resp) {
    let resultContainer = document.getElementById("activeSosDetails");
    if (!resultContainer) {
        resultContainer = document.createElement("div");
        resultContainer.id = "activeSosDetails";
        resultContainer.className = "card p-4 mt-4 shadow-sm";
        resultContainer.style.border = "2px solid #ef4554";
        resultContainer.style.borderRadius = "14px";
        const main = document.querySelector(".patient-main") || document.body;
        main.insertBefore(resultContainer, main.firstChild);
    }

    resultContainer.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h4 class="text-danger mb-0">🚨 Active Emergency Dispatch: ${resp.reference}</h4>
            <span class="badge bg-danger px-3 py-2">${resp.status}</span>
        </div>
        <div class="row g-3">
            <div class="col-md-6">
                <div class="p-3 bg-light rounded">
                    <strong>🚑 Assigned Ambulance</strong>
                    <p class="mb-1 mt-1">Vehicle: <b>${resp.ambulance ? resp.ambulance.vehicle_number : "Assigning..."}</b></p>
                    <p class="mb-0 text-muted">Driver: ${resp.ambulance ? resp.ambulance.driver_name : "Pending"}</p>
                </div>
            </div>
            <div class="col-md-6">
                <div class="p-3 bg-light rounded">
                    <strong>🏥 Destination Hospital</strong>
                    <p class="mb-1 mt-1">Facility: <b>${resp.hospital ? resp.hospital.name : "Solapur General Hospital"}</b></p>
                    <p class="mb-0 text-muted">Address: ${resp.hospital ? resp.hospital.address : "Civil Lines, Solapur"}</p>
                </div>
            </div>
        </div>
        <div class="mt-3 text-end">
            <button class="btn btn-outline-primary btn-sm" onclick="window.location.href='ambulance.html'">
                Track Ambulance on Live Map →
            </button>
        </div>
    `;
}

async function loadEmergencyHistory() {
    const listEl = document.getElementById("emergencyHistoryList") || document.getElementById("emergencyList");
    if (!listEl) return;

    try {
        const api = window.MedraAPI;
        const data = await api.get("/api/patient/emergencies");
        const list = data.emergencies || [];

        if (list.length === 0) {
            listEl.innerHTML = `<div class="text-muted text-center py-4">No previous emergency requests logged.</div>`;
            return;
        }

        listEl.innerHTML = list.map(e => `
            <div class="card mb-2 p-3 border-0 shadow-sm">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${e.reference}</strong> — <span class="text-muted">${e.emergency_type}</span>
                        <div class="small text-secondary mt-1">
                            ${e.description || 'Emergency alert'} · ${e.created_at ? new Date(e.created_at).toLocaleString() : ''}
                        </div>
                    </div>
                    <span class="badge ${e.status === 'RESOLVED' ? 'bg-success' : 'bg-warning text-dark'}">${e.status}</span>
                </div>
            </div>
        `).join("");
    } catch (e) {
        console.error("Unable to load emergency history:", e);
    }
}