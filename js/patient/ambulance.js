"use strict";

let trackingMap;
let trackingMarkers = [];
let trackingLine = null;
let trackingRequestInFlight = false;
let latestEmergency = null;

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["patient", "admin"])) return;

    const mapElement = document.getElementById("ambulanceMap");
    if (mapElement && typeof L !== "undefined") {
        trackingMap = L.map(mapElement).setView([20.5, 78.9], 5);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap contributors"
        }).addTo(trackingMap);
    }

    document.getElementById("myLocationButton")?.addEventListener("click", showPatientLocation);
    document.getElementById("refreshTracking")?.addEventListener("click", refreshTracking);
    document.getElementById("callDriverButton")?.addEventListener("click", callDriver);
    document.getElementById("shareLocationButton")?.addEventListener("click", shareEmergencyLocation);
    renderTimeline(null);
    document.getElementById("logoutButton")?.addEventListener("click", event => {
        event.preventDefault();
        if (typeof logoutMedra === "function") logoutMedra();
    });

    await loadTrackingData();
    window.setInterval(loadTrackingData, 10000);
});

async function loadTrackingData() {
    if (trackingRequestInFlight || !window.MedraAPI) return;
    trackingRequestInFlight = true;
    try {
        const response = await window.MedraAPI.get("/api/patient/emergencies/active");
        latestEmergency = response?.emergency || null;
        renderTracking(latestEmergency);
    } catch (error) {
        console.error("Emergency tracking refresh failed:", error);
        setText("routeStatus", error.message || "Unable to refresh emergency status.");
        if (typeof showNotification === "function") {
            showNotification(error.message || "Unable to refresh emergency status.", "warning");
        }
    } finally {
        trackingRequestInFlight = false;
    }
}

function renderTracking(emergency) {
    clearTrackingMap();
    if (!emergency) {
        setText("routeStatus", "No emergency request is currently on record.");
        setText("distanceValue", "Unavailable");
        setText("etaValue", "--");
        setText("detailEta", "--");
        setText("speedValue", "Unavailable");
        setText("trackingEmergencyStatus", "No active emergency");
        setText("trackingVehicleNumber", "Not assigned");
        setText("trackingVehicleStatus", "Waiting for an ambulance");
        setText("trackingDriverName", "Not assigned");
        setText("trackingHospital", "Not selected");
        setText("trackingLiveBadge", "STATUS UPDATES");
        renderTimeline(null);
        return;
    }

    const ambulance = emergency.ambulance;
    const hospital = emergency.hospital;
    const hasPickup = validCoordinates(emergency.latitude, emergency.longitude);
    const hasAmbulance = ambulance && validCoordinates(ambulance.latitude, ambulance.longitude);
    const hasHospital = hospital && validCoordinates(hospital.latitude, hospital.longitude);
    const locationFresh = emergency.ambulance_location_updated_at
        && isFreshLocation(emergency.ambulance_location_updated_at);

    setText("routeStatus", `${emergency.reference || "Emergency"} · ${emergency.status}`);
    setText("distanceValue", hasPickup && hasAmbulance && locationFresh
        ? `${straightLineDistance(ambulance.latitude, ambulance.longitude, emergency.latitude, emergency.longitude).toFixed(1)} km straight-line`
        : "Unavailable");
    setText("etaValue", "--");
    setText("detailEta", "Unavailable");
    setText("speedValue", "Unavailable");
    setText("trackingEmergencyStatus", `${emergency.reference || ""} · ${emergency.status} · ${emergency.emergency_type || ""}`);
    setText("trackingVehicleNumber", ambulance?.vehicle_number || "Not assigned");
    setText("trackingVehicleStatus", ambulance
        ? `${ambulance.status || "Assigned"}${locationFresh ? " · GPS current" : " · GPS unavailable or stale"}`
        : "Waiting for an ambulance to accept");
    setText("trackingVehicleSubstatus", ambulance
    ? (locationFresh ? "GPS location is current" : "GPS unavailable or stale")
    : "No ambulance assigned");
    setText("trackingDriverName", ambulance?.driver_name || "Not assigned");
    setText("trackingHospital", hospital ? `${hospital.name} · ${hospital.address}` : "Not selected by the ambulance crew");
    setText("trackingLiveBadge", locationFresh ? "GPS UPDATED" : "STATUS UPDATES");

    if (trackingMap) {
        const points = [];
        if (hasPickup) {
            addTrackingMarker([Number(emergency.latitude), Number(emergency.longitude)], "Patient pickup location");
            points.push([Number(emergency.latitude), Number(emergency.longitude)]);
        }
        if (hasAmbulance && locationFresh) {
            addTrackingMarker(
                [Number(ambulance.latitude), Number(ambulance.longitude)],
                `Ambulance ${ambulance.vehicle_number} · GPS updated ${new Date(emergency.ambulance_location_updated_at).toLocaleTimeString()}`
            );
            points.push([Number(ambulance.latitude), Number(ambulance.longitude)]);
        }
        if (hasHospital) {
            addTrackingMarker([Number(hospital.latitude), Number(hospital.longitude)], hospital.name);
            points.push([Number(hospital.latitude), Number(hospital.longitude)]);
        }

        if (points.length > 1) {
            trackingLine = L.polyline(points, { color: "#08a878", weight: 4, dashArray: "8 8" }).addTo(trackingMap);
            trackingMap.fitBounds(points, { padding: [40, 40] });
        } else if (points.length === 1) {
            trackingMap.setView(points[0], 14);
        }
    }
    renderTimeline(emergency);
}

function renderTimeline(emergency) {
    const timeline = document.querySelector(".response-timeline");
    if (!timeline) return;
    if (!emergency) {
        timeline.textContent = "Emergency activity will appear here after an SOS is submitted.";
        return;
    }

    const statusSteps = [
        ["REQUESTED", "Emergency request received"],
        ["ACCEPTED", "Ambulance accepted"],
        ["EN_ROUTE", "Ambulance en route"],
        ["PATIENT_PICKED_UP", "Patient picked up"],
        ["HOSPITAL_SELECTED", "Hospital selected"],
        ["HOSPITAL_ACCEPTED", "Hospital accepted"],
        ["HOSPITAL_ARRIVED", "Ambulance arrived"],
        ["HOSPITAL_RECEIVED", "Patient received"],
        ["RESOLVED", "Emergency resolved"]
    ];
    const currentIndex = statusSteps.findIndex(([status]) => status === emergency.status);
    const createdAt = emergency.created_at && Number.isFinite(Date.parse(emergency.created_at))
        ? new Date(emergency.created_at).toLocaleString()
        : "Time unavailable";
    timeline.innerHTML = statusSteps.map(([status, label], index) => {
        const state = index < currentIndex ? "completed" : index === currentIndex ? "active" : "";
        const timestamp = status === "REQUESTED" ? createdAt : index === currentIndex ? "Current status" : "Pending";
        return `<div class="timeline-item ${state}">
            <div class="timeline-icon">${index < currentIndex ? '<i class="bi bi-check-lg"></i>' : index + 1}</div>
            <div class="timeline-content">
                <strong>${escapeHtml(label)}</strong>
                <p>${status === emergency.status ? escapeHtml(emergency.description || emergency.emergency_type || "") : ""}</p>
                <small>${escapeHtml(timestamp)}</small>
            </div>
        </div>`;
    }).join("");
}

function addTrackingMarker(coordinates, label) {
    const marker = L.marker(coordinates).addTo(trackingMap).bindPopup(escapeHtml(label));
    trackingMarkers.push(marker);
}

function clearTrackingMap() {
    trackingMarkers.forEach(marker => marker.remove());
    trackingMarkers = [];
    if (trackingLine) {
        trackingLine.remove();
        trackingLine = null;
    }
}

function validCoordinates(latitude, longitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    return latitude !== null && latitude !== undefined
        && longitude !== null && longitude !== undefined
        && Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function isFreshLocation(timestamp) {
    const updatedAt = Date.parse(timestamp);
    const age = Date.now() - updatedAt;
    return Number.isFinite(updatedAt) && age >= 0 && age <= 120000;
}

function straightLineDistance(lat1, lng1, lat2, lng2) {
    const radians = degrees => degrees * Math.PI / 180;
    const dLat = radians(Number(lat2) - Number(lat1));
    const dLng = radians(Number(lng2) - Number(lng1));
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(radians(Number(lat1))) * Math.cos(radians(Number(lat2))) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function showPatientLocation() {
    if (!trackingMap || !latestEmergency || !validCoordinates(latestEmergency.latitude, latestEmergency.longitude)) {
        showTrackingMessage("Patient location is unavailable.");
        return;
    }
    const point = [Number(latestEmergency.latitude), Number(latestEmergency.longitude)];
    trackingMap.flyTo(point, 16);
}

async function refreshTracking() {
    const button = document.getElementById("refreshTracking");
    if (button) button.disabled = true;
    try {
        await loadTrackingData();
    } finally {
        if (button) button.disabled = false;
    }
}

function callDriver() {
    const mobile = latestEmergency?.ambulance?.driver_mobile;
    if (!mobile) {
        showTrackingMessage("A driver phone number is not available in your authorized emergency details.");
        return;
    }
    window.location.href = `tel:${encodeURIComponent(mobile)}`;
}

async function shareEmergencyLocation() {
    if (!latestEmergency || !validCoordinates(latestEmergency.latitude, latestEmergency.longitude)) {
        showTrackingMessage("There is no saved emergency location to share.");
        return;
    }
    const text = `MEDRA emergency ${latestEmergency.reference}: https://www.openstreetmap.org/?mlat=${latestEmergency.latitude}&mlon=${latestEmergency.longitude}`;
    try {
        if (navigator.share) {
            await navigator.share({ title: "MEDRA emergency location", text });
        } else if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
        } else {
            throw new Error("Location sharing is not supported by this browser.");
        }
        showTrackingMessage("Saved emergency location shared.");
    } catch (error) {
        if (error.name !== "AbortError") showTrackingMessage(error.message || "Unable to share emergency location.");
    }
}

function showTrackingMessage(message) {
    if (typeof showNotification === "function") showNotification(message, "info");
    else window.alert(message);
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? "";
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
