
/* =========================================================
   MEDRA PATIENT - EMERGENCY SOS CONTROLLER
   Uses existing FastAPI patient emergency endpoints.
   ========================================================= */

"use strict";

let currentCoordinates = null;
let submittingSOS = false;
let activeEmergency = null;
let historyRefreshTimer = null;

const TERMINAL_EMERGENCY_STATUSES = ["RESOLVED", "CANCELLED"];

document.addEventListener("DOMContentLoaded", async () => {
    if (
        typeof requireRoleAuth === "function" &&
        !requireRoleAuth(["patient", "admin"])
    ) {
        return;
    }

    setupSOSModal();
    setupLocationDetection();
    setupEmergencyActions();

    await Promise.all([
        loadActiveEmergency(),
        loadEmergencyHistory()
    ]);

    if (historyRefreshTimer) {
        window.clearInterval(historyRefreshTimer);
    }

    // Refresh status and history periodically.
    historyRefreshTimer = window.setInterval(async () => {
        await loadActiveEmergency();
        await loadEmergencyHistory();
    }, 10000);
});

/* =========================================================
   LOCATION DETECTION
   ========================================================= */

function setupLocationDetection() {
    const locationButton = document.getElementById("getLocationButton");

    if (!locationButton) return;

    locationButton.addEventListener("click", async () => {
        locationButton.disabled = true;

        try {
            await requestCurrentLocation();
        } finally {
            locationButton.disabled = false;
        }
    });
}

function requestCurrentLocation() {
    const locationText = document.getElementById("locationText");

    if (!navigator.geolocation) {
        currentCoordinates = null;

        if (locationText) {
            locationText.textContent =
                "Location is unavailable in this browser. " +
                "SOS can still be sent without coordinates.";
        }

        return Promise.resolve(null);
    }

    if (locationText) {
        locationText.textContent = "Requesting device location...";
    }

    return new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(
            position => {
                currentCoordinates = {
                    latitude: Number(position.coords.latitude.toFixed(6)),
                    longitude: Number(position.coords.longitude.toFixed(6))
                };

                if (locationText) {
                    locationText.textContent =
                        `Device location ready: ${currentCoordinates.latitude}, ` +
                        `${currentCoordinates.longitude}`;
                }

                resolve(currentCoordinates);
            },
            error => {
                currentCoordinates = null;

                let reason = "Device location is unavailable.";

                if (error.code === error.PERMISSION_DENIED) {
                    reason = "Location permission was denied.";
                } else if (error.code === error.TIMEOUT) {
                    reason = "Location request timed out.";
                }

                if (locationText) {
                    locationText.textContent =
                        `${reason} SOS can still be sent without coordinates.`;
                }

                resolve(null);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 30000
            }
        );
    });
}

/* =========================================================
   SOS CONFIRMATION MODAL
   ========================================================= */

function setupSOSModal() {
    const sendButton = document.getElementById("sendSOSButton");
    const modal = document.getElementById("sosModal");
    const cancelButton = document.getElementById("cancelSOS");
    const confirmButton = document.getElementById("confirmSOS");

    if (sendButton && modal) {
        sendButton.addEventListener("click", async () => {
            if (submittingSOS) return;

            const type = document.getElementById("emergencyType")?.value;

            if (!type) {
                notify("Please select an emergency category first.", "warning");
                return;
            }

            // Prevent creating another emergency while one is active.
            if (activeEmergency && isEmergencyActive(activeEmergency.status)) {
                notify(
                    "An active emergency already exists. Check its status before creating another.",
                    "warning"
                );
                return;
            }

            await requestCurrentLocation();

            modal.classList.add("show");
            modal.style.display = "flex";
        });
    }

    if (cancelButton && modal) {
        cancelButton.addEventListener("click", closeSOSModal);
    }

    if (confirmButton) {
        confirmButton.addEventListener("click", submitRealEmergency);
    }
}

function closeSOSModal() {
    const modal = document.getElementById("sosModal");

    if (!modal) return;

    modal.classList.remove("show");
    modal.style.display = "none";
}

/* =========================================================
   CREATE EMERGENCY
   ========================================================= */

async function submitRealEmergency() {
    if (submittingSOS) return;

    const confirmButton = document.getElementById("confirmSOS");
    const sendButton = document.getElementById("sendSOSButton");
    const typeSelect = document.getElementById("emergencyType");
    const descriptionInput = document.getElementById("emergencyDescription");

    const emergencyType = typeSelect?.value || "";
    const description = descriptionInput?.value.trim() || "";

    if (!emergencyType.trim()) {
        notify("Select an emergency type before submitting.", "warning");
        return;
    }

    if (activeEmergency && isEmergencyActive(activeEmergency.status)) {
        notify("You already have an active emergency.", "warning");
        closeSOSModal();
        return;
    }

    submittingSOS = true;

    if (sendButton) {
        sendButton.disabled = true;
    }

    if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.innerHTML =
            '<span class="spinner-border spinner-border-sm me-2" ' +
            'aria-hidden="true"></span>Sending SOS...';
    }

    try {
        const api = window.MedraAPI;

        if (!api || typeof api.post !== "function") {
            throw new Error("MEDRA backend client is unavailable.");
        }

        let idempotencyKey = sessionStorage.getItem("medra_pending_sos_key");

        if (!idempotencyKey) {
            idempotencyKey = createIdempotencyKey();
            sessionStorage.setItem("medra_pending_sos_key", idempotencyKey);
        }

        const response = await api.post("/api/patient/emergency", {
            emergency_type: emergencyType,
            description,
            latitude: currentCoordinates?.latitude ?? null,
            longitude: currentCoordinates?.longitude ?? null,
            idempotency_key: idempotencyKey
        });

        if (
            !response ||
            !Number.isFinite(Number(response.emergency_id)) ||
            Number(response.emergency_id) <= 0 ||
            typeof response.status !== "string" ||
            !response.status.trim()
        ) {
            throw new Error(
                "MEDRA did not confirm that the emergency was created. Please check its status before retrying."
            );
        }

        sessionStorage.removeItem("medra_pending_sos_key");

        closeSOSModal();

        // The create endpoint returns the emergency object directly.
        activeEmergency = {
            id: response.emergency_id,
            reference: response.reference,
            emergency_type: response.emergency_type || response.type,
            description: response.description,
            latitude: response.latitude,
            longitude: response.longitude,
            status: response.status,
            priority: response.priority,
            created_at: response.created_at,
            ambulance: response.ambulance,
            hospital: response.hospital
        };

        updateEmergencyStatus(activeEmergency);
        updateEmergencyActions();
        displayActiveResult(response);

        setActionMessage(
            `Emergency ${response.reference || ""} registered. ` +
            "Waiting for ambulance acceptance.",
            "success"
        );

        notify(
            `Emergency ${response.reference || ""} registered successfully.`,
            "success"
        );

        await loadEmergencyHistory();

    } catch (error) {
        console.error("SOS submission error:", error);

        notify(
            error?.message ||
            "Failed to send SOS. If this is a real emergency, contact local emergency services.",
            "error"
        );

        setActionMessage(
            error?.message ||
            "SOS submission failed. If this is a real emergency, contact local emergency services.",
            "error"
        );

    } finally {
        submittingSOS = false;

        if (sendButton) {
            sendButton.disabled = false;
        }

        if (confirmButton) {
            confirmButton.disabled = false;
            confirmButton.innerHTML =
                '<i class="bi bi-broadcast-pin"></i> Confirm SOS';
        }
    }
}

/* =========================================================
   ACTIVE EMERGENCY AND TRACKING
   ========================================================= */

function setupEmergencyActions() {
    const trackButton = document.getElementById("trackEmergencyButton");
    const cancelButton = document.getElementById("cancelEmergencyButton");

    if (trackButton) {
        trackButton.addEventListener("click", openEmergencyTracking);
    }

    if (cancelButton) {
        // No cancellation endpoint currently exists in patient.py.
        cancelButton.disabled = true;
        cancelButton.title =
            "Emergency cancellation is unavailable until the backend supports it.";
    }

    updateEmergencyActions();
}

async function loadActiveEmergency() {
    const api = window.MedraAPI;

    if (!api || typeof api.get !== "function") {
        setActionMessage("MEDRA backend client is unavailable.", "error");
        return;
    }

    try {
        const data = await api.get("/api/patient/emergencies/active");

        if (!data || !data.has_active || !data.emergency) {
            activeEmergency = null;

            updateEmergencyActions();

            const stateElement = document.getElementById("emergencyState");

            if (stateElement) {
                stateElement.textContent = "No Active Emergency";
                stateElement.style.background = "";
                stateElement.style.color = "";
            }

            const details = document.getElementById("activeSosDetails");

            if (details) {
                details.remove();
            }

            setActionMessage("No active emergency.", "info");
            return;
        }

        activeEmergency = data.emergency;

        updateEmergencyStatus(activeEmergency);
        updateEmergencyActions();
        displayActiveResult(activeEmergency);

    } catch (error) {
        console.error("Unable to load active emergency:", error);

        // Keep previously loaded state if a temporary request fails.
        setActionMessage(
            "Unable to refresh emergency status. Check your connection.",
            "error"
        );
    }
}

function isEmergencyActive(status) {
    return !TERMINAL_EMERGENCY_STATUSES.includes(
        String(status || "").toUpperCase()
    );
}

function updateEmergencyActions() {
    const trackButton = document.getElementById("trackEmergencyButton");
    const cancelButton = document.getElementById("cancelEmergencyButton");

    const hasActive = Boolean(
        activeEmergency && isEmergencyActive(activeEmergency.status)
    );

    if (trackButton) {
        trackButton.disabled = !hasActive;
    }

    // Intentionally disabled until a real cancellation route is implemented.
    if (cancelButton) {
        cancelButton.disabled = true;
    }
}

function openEmergencyTracking() {
    if (!activeEmergency || !isEmergencyActive(activeEmergency.status)) {
        setActionMessage("There is no active emergency to track.", "warning");
        return;
    }

    const ambulance = activeEmergency.ambulance;
    const latitude = Number(ambulance?.latitude);
    const longitude = Number(ambulance?.longitude);

    if (
        ambulance &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
    ) {
        const mapUrl =
            `https://www.openstreetmap.org/?mlat=${latitude}` +
            `&mlon=${longitude}#map=16/${latitude}/${longitude}`;

        window.open(mapUrl, "_blank", "noopener,noreferrer");

        setActionMessage(
            "Showing the ambulance's last reported location.",
            "success"
        );

        return;
    }

    const patientLatitude = Number(activeEmergency.latitude);
    const patientLongitude = Number(activeEmergency.longitude);

    if (
        Number.isFinite(patientLatitude) &&
        Number.isFinite(patientLongitude) &&
        activeEmergency.latitude !== null &&
        activeEmergency.longitude !== null &&
        patientLatitude >= -90 &&
        patientLatitude <= 90 &&
        patientLongitude >= -180 &&
        patientLongitude <= 180
    ) {
        const mapUrl =
            `https://www.openstreetmap.org/?mlat=${patientLatitude}` +
            `&mlon=${patientLongitude}#map=16/${patientLatitude}/${patientLongitude}`;

        window.open(mapUrl, "_blank", "noopener,noreferrer");

        setActionMessage(
            "Showing the saved emergency pickup location. " +
            "Live ambulance coordinates are not available yet.",
            "info"
        );

        return;
    }

    setActionMessage(
        "No location coordinates are available for this emergency yet.",
        "warning"
    );
}

/* =========================================================
   EMERGENCY STATUS
   ========================================================= */

function updateEmergencyStatus(emergency) {
    const stateElement = document.getElementById("emergencyState");

    if (!stateElement || !emergency) return;

    const status = String(emergency.status || "REQUESTED").toUpperCase();
    const reference = emergency.reference || "";

    stateElement.textContent = reference
        ? `${reference} — ${status}`
        : status;

    if (TERMINAL_EMERGENCY_STATUSES.includes(status)) {
        stateElement.style.background = "#e8f7ee";
        stateElement.style.color = "#167545";
    } else {
        stateElement.style.background = "#fff0f2";
        stateElement.style.color = "#d63848";
    }
}

/* =========================================================
   EMERGENCY RESULT CARD
   ========================================================= */

function displayActiveResult(response) {
    if (!response) return;

    let resultContainer = document.getElementById("activeSosDetails");

    if (!resultContainer) {
        resultContainer = document.createElement("div");
        resultContainer.id = "activeSosDetails";
        resultContainer.className = "card p-4 mt-4 shadow-sm";
        resultContainer.style.border = "2px solid #9dc8ed";
        resultContainer.style.borderRadius = "14px";

        const main = document.querySelector(".patient-main") || document.body;
        const content = main.querySelector(".patient-content");

        if (content) {
            content.prepend(resultContainer);
        } else {
            main.prepend(resultContainer);
        }
    }

    const latitude = Number(response.latitude);
    const longitude = Number(response.longitude);

    const hasLocation =
        response.latitude !== null &&
        response.longitude !== null &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;

    const locationLink = hasLocation
        ? `<a href="https://www.openstreetmap.org/?mlat=${latitude}&amp;mlon=${longitude}#map=16/${latitude}/${longitude}" target="_blank" rel="noopener noreferrer">Open saved pickup location</a>`
        : "Location was not provided";

    const ambulance = response.ambulance;
    const hospital = response.hospital;

    resultContainer.innerHTML = `
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
            <h4 class="mb-0" style="color:#c8374a">
                Emergency: ${escapeHtml(response.reference || "Pending reference")}
            </h4>
            <span class="badge bg-danger px-3 py-2">
                ${escapeHtml(response.status || "REQUESTED")}
            </span>
        </div>

        <div class="row g-3">
            <div class="col-md-6">
                <div class="p-3 rounded h-100" style="background:#f0f7ff">
                    <strong>Emergency details</strong>
                    <p class="mb-1 mt-2">
                        ${escapeHtml(response.emergency_type || response.type || "Emergency")}
                    </p>
                    <p class="mb-0 text-muted">
                        ${escapeHtml(response.description || "No additional details provided.")}
                    </p>
                </div>
            </div>

            <div class="col-md-6">
                <div class="p-3 rounded h-100" style="background:#f0f7ff">
                    <strong>Pickup location</strong>
                    <p class="mb-1 mt-2">${locationLink}</p>
                    <p class="mb-0 text-muted">
                        ${escapeHtml(formatDate(response.created_at))}
                    </p>
                </div>
            </div>

            <div class="col-md-6">
                <div class="p-3 rounded h-100" style="background:#f0f7ff">
                    <strong>Ambulance assignment</strong>
                    <p class="mb-1 mt-2">
                        Vehicle:
                        <b>${escapeHtml(ambulance?.vehicle_number || "Waiting for an eligible ambulance")}</b>
                    </p>
                    <p class="mb-0 text-muted">
                        Driver: ${escapeHtml(ambulance?.driver_name || "Not assigned")}
                    </p>
                    ${
                        ambulance?.latitude != null && ambulance?.longitude != null
                            ? `<p class="small mb-0 mt-2">Last reported ambulance coordinates are available.</p>`
                            : `<p class="small mb-0 mt-2">Ambulance coordinates are not available.</p>`
                    }
                </div>
            </div>

            <div class="col-md-6">
                <div class="p-3 rounded h-100" style="background:#f0f7ff">
                    <strong>Destination hospital</strong>
                    <p class="mb-1 mt-2">
                        Facility: <b>${escapeHtml(hospital?.name || "Not assigned")}</b>
                    </p>
                    <p class="mb-0 text-muted">
                        Address: ${escapeHtml(hospital?.address || "Not assigned")}
                    </p>
                </div>
            </div>
        </div>

        <div class="mt-3 text-end">
            <span class="small text-muted">
                ${escapeHtml(response.patient_name || "")}
            </span>
        </div>
    `;
}

/* =========================================================
   EMERGENCY HISTORY
   ========================================================= */

async function loadEmergencyHistory() {
    const listElement =
        document.getElementById("emergencyHistoryList") ||
        document.getElementById("emergencyList");

    if (!listElement) return;

    try {
        const api = window.MedraAPI;

        if (!api || typeof api.get !== "function") {
            throw new Error("MEDRA backend client is unavailable.");
        }

        const data = await api.get("/api/patient/emergencies");
        const emergencies = Array.isArray(data.emergencies)
            ? data.emergencies
            : [];

        if (emergencies.length === 0) {
            listElement.innerHTML =
                '<div class="text-muted text-center py-4">' +
                'No previous emergency requests logged.' +
                '</div>';
            return;
        }

        listElement.innerHTML = emergencies.map(emergency => {
            const status = String(emergency.status || "UNKNOWN").toUpperCase();
            const isTerminal = TERMINAL_EMERGENCY_STATUSES.includes(status);

            return `
                <div class="card mb-2 p-3 border-0 shadow-sm">
                    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                        <div>
                            <strong>${escapeHtml(emergency.reference || "Emergency")}</strong>
                            —
                            <span class="text-muted">
                                ${escapeHtml(emergency.emergency_type || "Emergency")}
                            </span>

                            <div class="small text-secondary mt-1">
                                ${escapeHtml(emergency.description || "Emergency alert")}
                                · ${escapeHtml(formatDate(emergency.created_at))}
                            </div>
                        </div>

                        <span class="badge ${
                            isTerminal
                                ? "bg-success"
                                : "bg-warning text-dark"
                        }">
                            ${escapeHtml(status)}
                        </span>
                    </div>
                </div>
            `;
        }).join("");

    } catch (error) {
        console.error("Unable to load emergency history:", error);
    }
}

/* =========================================================
   UI HELPERS
   ========================================================= */

function setActionMessage(message, type = "info") {
    const element = document.getElementById("emergencyActionMessage");

    if (!element) return;

    element.textContent = message;

    const colors = {
        success: "#167545",
        error: "#b42332",
        warning: "#9a6700",
        info: "#365b7d"
    };

    element.style.color = colors[type] || colors.info;
}

function notify(message, type = "info") {
    if (typeof showNotification === "function") {
        showNotification(message, type);
    } else {
        alert(message);
    }
}

function formatDate(value) {
    if (!value) return "";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleString();
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

function createIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);

    if (window.crypto?.getRandomValues) {
        window.crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(
        bytes,
        byte => byte.toString(16).padStart(2, "0")
    ).join("");

    return (
        `${hex.slice(0, 8)}-${hex.slice(8, 12)}-` +
        `${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    );
}
