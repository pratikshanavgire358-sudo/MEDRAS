"use strict";

/*
=========================================================
 MEDRA EC DRIVER DASHBOARD
 Features:
 1. Load pending emergency SOS requests
 2. Accept an emergency
 3. Reject an emergency
 4. Refresh automatically every 10 seconds
 5. Display emergency priority and patient location
 6. Connect to the existing FastAPI backend
=========================================================
*/

let driverEmergencies = [];
let driverLoading = false;
let driverActionInProgress = false;
let driverRefreshTimer = null;

const driverApi = () => window.MedraAPI;

const driverElement = (id) => document.getElementById(id);


// -------------------------------------------------------
// INITIALIZE DASHBOARD
// -------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function") {
        if (!requireRoleAuth(["ambulance"])) {
            return;
        }
    }

    const api = driverApi();

    if (!api) {
        console.error("MEDRA API helper is not available.");
        showDriverMessage(
            "Unable to connect to the MEDRA API service.",
            "error"
        );
        return;
    }

    const currentUser = api.getCurrentUser?.();

    if (
        currentUser?.ambulance_subrole &&
        currentUser.ambulance_subrole !== "EC_DRIVER"
    ) {
        showDriverMessage(
            "This dashboard is only for EC Driver accounts.",
            "error"
        );
        return;
    }

    prepareDriverDashboard();
    bindDriverEvents();

    await loadPendingEmergencies();

    // Keep the dashboard synchronized with backend data.
    driverRefreshTimer = window.setInterval(() => {
        loadPendingEmergencies();
    }, 10000);
});


// -------------------------------------------------------
// PREPARE DASHBOARD
// -------------------------------------------------------

function prepareDriverDashboard() {
    const currentUser = driverApi()?.getCurrentUser?.();

    const nameElement =
        driverElement("driverName") ||
        driverElement("driverSidebarName") ||
        driverElement("welcomeDriverName");

    if (nameElement && currentUser?.full_name) {
        nameElement.textContent = currentUser.full_name;
    }

    const dateElement = driverElement("currentDate");

    if (dateElement) {
        dateElement.textContent = new Date().toLocaleDateString(
            undefined,
            {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric"
            }
        );
    }

    // Reuse an existing emergency container if available.
    let container = getEmergencyContainer();

    // If the HTML does not contain one, create a section.
    if (!container) {
        const main =
            document.querySelector("main") ||
            document.querySelector(".dashboard-main") ||
            document.querySelector(".driver-main") ||
            document.body;

        const section = document.createElement("section");

        section.id = "ecDriverEmergencySection";
        section.style.cssText = `
            margin: 24px auto;
            padding: 24px;
            max-width: 1200px;
            background: #ffffff;
            border: 1px solid #d9e8f5;
            border-radius: 16px;
            box-shadow: 0 5px 20px rgba(34, 90, 140, 0.06);
        `;

        section.innerHTML = `
            <div style="
                display:flex;
                justify-content:space-between;
                align-items:center;
                gap:12px;
                flex-wrap:wrap;
                margin-bottom:20px;
            ">
                <div>
                    <h2 style="margin:0;color:#163b5c;">
                        Pending Emergency Requests
                    </h2>

                    <p style="margin:6px 0 0;color:#60758a;">
                        Review new SOS requests and respond promptly.
                    </p>
                </div>

                <button
                    type="button"
                    id="ecDriverRefreshButton"
                    style="
                        padding:10px 16px;
                        border:1px solid #bdd8ee;
                        border-radius:9px;
                        background:#edf7ff;
                        color:#174b78;
                        cursor:pointer;
                        font-weight:600;
                    "
                >
                    Refresh
                </button>
            </div>

            <div
                id="ecDriverMessage"
                role="status"
                aria-live="polite"
                style="margin-bottom:12px;"
            ></div>

            <div
                id="ecDriverPendingList"
                aria-live="polite"
            ></div>
        `;

        main.prepend(section);
        container = driverElement("ecDriverPendingList");
    }
}


// -------------------------------------------------------
// FIND EMERGENCY CONTAINER
// -------------------------------------------------------

function getEmergencyContainer() {
    const possibleIds = [
        "ecDriverPendingList",
        "pendingEmergenciesList",
        "pendingEmergencies",
        "pendingCasesList",
        "emergencyList",
        "emergenciesContainer",
        "pendingEmergencyContainer"
    ];

    for (const id of possibleIds) {
        const element = driverElement(id);

        if (element) {
            return element;
        }
    }

    return null;
}


// -------------------------------------------------------
// BUTTON EVENTS
// -------------------------------------------------------

function bindDriverEvents() {
    document.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-driver-action]");

        if (!button) {
            return;
        }

        const emergencyId = Number(button.dataset.emergencyId);
        const action = button.dataset.driverAction;

        if (!Number.isInteger(emergencyId) || emergencyId <= 0) {
            showDriverMessage(
                "Invalid emergency ID.",
                "error"
            );
            return;
        }

        if (action === "accept") {
            await acceptDriverEmergency(emergencyId, button);
        }

        if (action === "reject") {
            await rejectDriverEmergency(emergencyId, button);
        }
    });

    document.addEventListener("click", (event) => {
        const refreshButton = event.target.closest(
            "#ecDriverRefreshButton, #refreshButton, #refreshEmergenciesButton"
        );

        if (refreshButton) {
            loadPendingEmergencies();
        }
    });

    const logoutButton =
        driverElement("logoutButton") ||
        driverElement("logoutDriverButton");

    if (logoutButton) {
        logoutButton.addEventListener("click", () => {
            window.logoutMedra?.();
        });
    }
}


// -------------------------------------------------------
// LOAD PENDING EMERGENCIES
// GET /api/ambulance/emergencies/pending
// -------------------------------------------------------

async function loadPendingEmergencies() {
    if (driverLoading || driverActionInProgress) {
        return;
    }

    const api = driverApi();
    const container = getEmergencyContainer();

    if (!api || !container) {
        return;
    }

    driverLoading = true;

    try {
        const response = await api.get(
            "/api/ambulance/emergencies/pending"
        );

        driverEmergencies = Array.isArray(response?.emergencies)
            ? response.emergencies
            : [];

        renderPendingEmergencies();

        updateDriverEmergencyCount();

        setDriverConnectionStatus(true);

    } catch (error) {
        console.error(
            "Unable to load pending emergencies:",
            error
        );

        setDriverConnectionStatus(false);

        showDriverMessage(
            error.message ||
            "Unable to load emergencies. Check your login and backend connection.",
            "error"
        );

    } finally {
        driverLoading = false;
    }
}


// -------------------------------------------------------
// DISPLAY EMERGENCY CARDS
// -------------------------------------------------------

function renderPendingEmergencies() {
    const container = getEmergencyContainer();

    if (!container) {
        return;
    }

    if (driverEmergencies.length === 0) {
        container.innerHTML = `
            <div style="
                padding:30px 18px;
                text-align:center;
                background:#f4faff;
                border:1px dashed #c6dced;
                border-radius:12px;
            ">
                <div style="
                    font-size:36px;
                    margin-bottom:10px;
                ">
                    ✓
                </div>

                <h3 style="
                    margin:0 0 8px;
                    color:#234968;
                ">
                    No Pending Emergencies
                </h3>

                <p style="
                    margin:0;
                    color:#62798d;
                ">
                    New eligible SOS requests will appear here automatically.
                </p>
            </div>
        `;

        return;
    }

    container.innerHTML = driverEmergencies
        .map((emergency) => createEmergencyCard(emergency))
        .join("");
}


// -------------------------------------------------------
// CREATE AN EMERGENCY CARD
// -------------------------------------------------------

function createEmergencyCard(emergency) {
    const id = Number(emergency.id);

    const reference =
        emergency.reference ||
        `MEDRA-EMG-${String(id).padStart(4, "0")}`;

    const type = emergency.emergency_type || "Emergency";

    const description =
        emergency.description || "No additional details provided.";

    const priority = String(
        emergency.priority || "NORMAL"
    ).toUpperCase();

    const priorityColor = {
        CRITICAL: "#b42318",
        HIGH: "#c2410c",
        NORMAL: "#1763a6"
    }[priority] || "#53677a";

    const latitude = emergency.pickup_latitude;
    const longitude = emergency.pickup_longitude;

    const hasLocation =
        latitude !== null &&
        latitude !== undefined &&
        longitude !== null &&
        longitude !== undefined &&
        Number.isFinite(Number(latitude)) &&
        Number.isFinite(Number(longitude));

    const locationHtml = hasLocation
        ? `
            <p style="margin:8px 0;color:#536b80;">
                <strong>Patient coordinates:</strong>
                ${escapeDriverHtml(latitude)},
                ${escapeDriverHtml(longitude)}
            </p>

            <a
                href="https://www.google.com/maps?q=${encodeURIComponent(latitude)},${encodeURIComponent(longitude)}"
                target="_blank"
                rel="noopener noreferrer"
                style="
                    display:inline-block;
                    margin-bottom:10px;
                    color:#1763a6;
                    font-weight:600;
                "
            >
                View location on map
            </a>
        `
        : `
            <p style="margin:8px 0;color:#9a3412;">
                Patient coordinates are not available.
            </p>
        `;

    const createdAt = emergency.created_at
        ? new Date(emergency.created_at).toLocaleString()
        : "Time unavailable";

    return `
        <article style="
            padding:20px;
            margin-bottom:16px;
            background:#ffffff;
            border:1px solid #d7e6f2;
            border-left:5px solid ${priorityColor};
            border-radius:12px;
        ">
            <div style="
                display:flex;
                justify-content:space-between;
                align-items:flex-start;
                flex-wrap:wrap;
                gap:12px;
            ">
                <div>
                    <h3 style="
                        margin:0 0 6px;
                        color:#173d5b;
                    ">
                        ${escapeDriverHtml(type)}
                    </h3>

                    <p style="
                        margin:0;
                        color:#61778b;
                        font-size:14px;
                    ">
                        ${escapeDriverHtml(reference)}
                    </p>
                </div>

                <span style="
                    padding:6px 10px;
                    border-radius:20px;
                    background:${priorityColor};
                    color:#ffffff;
                    font-size:12px;
                    font-weight:700;
                ">
                    ${escapeDriverHtml(priority)} PRIORITY
                </span>
            </div>

            <p style="
                margin:16px 0 8px;
                color:#344e63;
                line-height:1.6;
            ">
                ${escapeDriverHtml(description)}
            </p>

            ${locationHtml}

            <p style="
                margin:5px 0 16px;
                color:#61778b;
                font-size:13px;
            ">
                <strong>Received:</strong>
                ${escapeDriverHtml(createdAt)}
            </p>

            <div style="
                display:flex;
                gap:10px;
                flex-wrap:wrap;
            ">
                <button
                    type="button"
                    data-driver-action="accept"
                    data-emergency-id="${id}"
                    style="
                        padding:11px 20px;
                        border:0;
                        border-radius:8px;
                        background:#16794b;
                        color:#ffffff;
                        font-weight:700;
                        cursor:pointer;
                    "
                >
                    Accept Emergency
                </button>

                <button
                    type="button"
                    data-driver-action="reject"
                    data-emergency-id="${id}"
                    style="
                        padding:11px 20px;
                        border:1px solid #f0b9b9;
                        border-radius:8px;
                        background:#fff4f4;
                        color:#b42318;
                        font-weight:700;
                        cursor:pointer;
                    "
                >
                    Reject
                </button>
            </div>
        </article>
    `;
}


// -------------------------------------------------------
// ACCEPT EMERGENCY
// POST /api/ambulance/emergencies/{id}/accept
// -------------------------------------------------------

async function acceptDriverEmergency(emergencyId, button) {
    const emergency = driverEmergencies.find(
        item => Number(item.id) === emergencyId
    );

    if (!emergency) {
        showDriverMessage(
            "This emergency is no longer in the pending list. Refresh the dashboard.",
            "warning"
        );

        await loadPendingEmergencies();
        return;
    }

    const confirmed = window.confirm(
        `Accept ${emergency.reference || `MEDRA-EMG-${emergencyId}`}?\n\n` +
        "This will assign the emergency to your ambulance if the backend accepts the request."
    );

    if (!confirmed) {
        return;
    }

    driverActionInProgress = true;

    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = "Accepting...";

    try {
        const response = await driverApi().post(
            `/api/ambulance/emergencies/${emergencyId}/accept`,
            {}
        );

        showDriverMessage(
            response?.message ||
            "Emergency accepted successfully.",
            "success"
        );

        // Remove it locally; the backend remains the source of truth.
        driverEmergencies = driverEmergencies.filter(
            item => Number(item.id) !== emergencyId
        );

        renderPendingEmergencies();
        updateDriverEmergencyCount();

    } catch (error) {
        console.error("Accept emergency failed:", error);

        showDriverMessage(
            error.message ||
            "Could not accept this emergency. It may already have been assigned.",
            "error"
        );

    } finally {
        driverActionInProgress = false;
        button.disabled = false;
        button.textContent = originalText;

        await loadPendingEmergencies();
    }
}


// -------------------------------------------------------
// REJECT EMERGENCY
// POST /api/ambulance/emergencies/{id}/reject
// -------------------------------------------------------

async function rejectDriverEmergency(emergencyId, button) {
    const emergency = driverEmergencies.find(
        item => Number(item.id) === emergencyId
    );

    if (!emergency) {
        showDriverMessage(
            "This emergency is no longer in the pending list.",
            "warning"
        );

        await loadPendingEmergencies();
        return;
    }

    const confirmed = window.confirm(
        `Reject ${emergency.reference || `MEDRA-EMG-${emergencyId}`}?\n\n` +
        "It will remain available to other eligible drivers."
    );

    if (!confirmed) {
        return;
    }

    driverActionInProgress = true;

    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = "Rejecting...";

    try {
        const response = await driverApi().post(
            `/api/ambulance/emergencies/${emergencyId}/reject`,
            {}
        );

        showDriverMessage(
            response?.message ||
            "Rejection recorded successfully.",
            "success"
        );

        driverEmergencies = driverEmergencies.filter(
            item => Number(item.id) !== emergencyId
        );

        renderPendingEmergencies();
        updateDriverEmergencyCount();

    } catch (error) {
        console.error("Reject emergency failed:", error);

        showDriverMessage(
            error.message ||
            "Could not reject this emergency. Refresh and try again.",
            "error"
        );

    } finally {
        driverActionInProgress = false;
        button.disabled = false;
        button.textContent = originalText;

        await loadPendingEmergencies();
    }
}


// -------------------------------------------------------
// UPDATE EMERGENCY COUNTERS
// -------------------------------------------------------

function updateDriverEmergencyCount() {
    const possibleIds = [
        "pendingEmergencyCount",
        "pendingCount",
        "activeCasesCount",
        "navEmergencyCount"
    ];

    possibleIds.forEach(id => {
        const element = driverElement(id);

        if (element) {
            element.textContent = String(driverEmergencies.length);
        }
    });
}


// -------------------------------------------------------
// CONNECTION STATUS
// -------------------------------------------------------

function setDriverConnectionStatus(isOnline) {
    const element =
        driverElement("connectionStatus") ||
        driverElement("systemStatus");

    if (element) {
        element.textContent = isOnline
            ? "MEDRA services connected"
            : "Connection issue — retrying";

        element.style.color = isOnline
            ? "#16794b"
            : "#b42318";
    }
}


// -------------------------------------------------------
// STATUS / ERROR MESSAGES
// -------------------------------------------------------

function showDriverMessage(message, type = "info") {
    const messageElement =
        driverElement("ecDriverMessage") ||
        driverElement("driverMessage") ||
        driverElement("messageContainer");

    if (!messageElement) {
        if (type === "error") {
            console.error(message);
        } else {
            console.info(message);
        }

        return;
    }

    const styles = {
        success: {
            background: "#eaf8ef",
            color: "#17633a",
            border: "#b7e2c5"
        },
        error: {
            background: "#fff0f0",
            color: "#a61b1b",
            border: "#f1c1c1"
        },
        warning: {
            background: "#fff8e8",
            color: "#8a5300",
            border: "#f0d69a"
        },
        info: {
            background: "#edf7ff",
            color: "#174b78",
            border: "#c5dff4"
        }
    };

    const style = styles[type] || styles.info;

    messageElement.textContent = message;
    messageElement.style.cssText += `
        display:block;
        padding:12px 14px;
        margin-bottom:12px;
        border:1px solid ${style.border};
        border-radius:8px;
        background:${style.background};
        color:${style.color};
    `;

    if (showDriverMessage.timeout) {
        clearTimeout(showDriverMessage.timeout);
    }

    showDriverMessage.timeout = setTimeout(() => {
        messageElement.textContent = "";
    }, 6000);
}


// -------------------------------------------------------
// HTML ESCAPING
// Prevent user-provided text from being treated as HTML.
// -------------------------------------------------------

function escapeDriverHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[character];
    });
}