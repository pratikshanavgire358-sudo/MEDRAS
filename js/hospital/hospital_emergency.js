"use strict";

/* =========================================================
   MEDRA HOSPITAL EMERGENCY ARRIVALS CONTROLLER
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["hospital", "admin"])) {
        return;
    }

    const tableBody = document.getElementById("emergencyTableBody");
    const searchInput = document.getElementById("emergencySearch");
    const priorityFilter = document.getElementById("emergencyPriorityFilter");
    const statusFilter = document.getElementById("emergencyStatusFilter");
    const resetButton = document.getElementById("resetEmergencyFilters");
    const refreshButton = document.getElementById("refreshEmergencyQueue");
    const emptyState = document.getElementById("emergencyEmptyState");
    const resultCount = document.getElementById("emergencyResultCount");

    const detailsPanel = document.getElementById("emergencyDetailsPanel");
    const closeDetailsButton = document.getElementById("closeEmergencyDetails");

    const markArrivedBtn = document.getElementById("markEmergencyArrived");
    const markReceivedBtn = document.getElementById("markEmergencyReceived");
    const actionMessage = document.getElementById("emergencyActionMessage");

    let loadedEmergencies = [];
    let selectedEmergency = null;

    async function loadEmergencies() {
        const api = window.MedraAPI;
        if (!api) return;

        try {
            const data = await api.get("/api/hospital/emergencies");
            loadedEmergencies = data.emergencies || [];
            applyFilters();
        } catch (err) {
            console.error("Emergencies fetch error:", err);
            if (typeof showNotification === "function") {
                showNotification(err.message || "Unable to fetch emergency queue.", "error");
            }
        }
    }

    function applyFilters() {
        const query = (searchInput?.value || "").toLowerCase().trim();
        const pFilter = priorityFilter?.value || "";
        const sFilter = statusFilter?.value || "";

        const filtered = loadedEmergencies.filter(e => {
            const matchQuery = !query || 
                e.reference.toLowerCase().includes(query) ||
                e.type.toLowerCase().includes(query) ||
                (e.patient_name && e.patient_name.toLowerCase().includes(query)) ||
                (e.ambulance_vehicle && e.ambulance_vehicle.toLowerCase().includes(query));

            const matchPriority = !pFilter || e.priority === pFilter;
            const matchStatus = !sFilter || e.status === sFilter;

            return matchQuery && matchPriority && matchStatus;
        });

        renderTable(filtered);
        updateStatistics(loadedEmergencies);
    }

    function renderTable(records) {
        if (!tableBody) return;
        tableBody.innerHTML = "";

        if (records.length === 0) {
            if (emptyState) emptyState.hidden = false;
            if (resultCount) resultCount.textContent = "0";
            return;
        }

        if (emptyState) emptyState.hidden = true;
        if (resultCount) resultCount.textContent = records.length;

        records.forEach(e => {
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";
            if (selectedEmergency && selectedEmergency.id === e.id) {
                tr.classList.add("selected-row");
            }

            const priorityClass = e.priority === "Critical" ? "badge bg-danger" : "badge bg-warning text-dark";
            const statusClass = e.status === "ARRIVED" ? "badge bg-success" : "badge bg-info text-dark";

            tr.innerHTML = `
                <td><strong>${e.reference}</strong></td>
                <td>${e.patient_name}</td>
                <td>${e.type}</td>
                <td><span class="${priorityClass}">${e.priority}</span></td>
                <td><span class="${statusClass}">${e.status}</span></td>
                <td>${e.ambulance_vehicle}</td>
                <td>${e.created_at ? new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}</td>
            `;

            tr.addEventListener("click", () => selectEmergency(e));
            tableBody.appendChild(tr);
        });
    }

    function selectEmergency(e) {
        selectedEmergency = e;
        if (detailsPanel) detailsPanel.hidden = false;

        setFieldText("selectedEmergencyReference", e.reference);
        setFieldText("selectedEmergencyType", e.type);
        setFieldText("selectedEmergencyPriority", e.priority);
        setFieldText("selectedEmergencyStatus", e.status);
        setFieldText("selectedEmergencyDescription", e.description || "Emergency dispatch alert");

        // Highlight selected
        document.querySelectorAll("#emergencyTableBody tr").forEach(row => row.classList.remove("selected-row"));
        if (actionMessage) actionMessage.textContent = "";
    }

    function setFieldText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text || "-";
    }

    function updateStatistics(records) {
        const critical = records.filter(r => r.priority === "Critical").length;
        const incoming = records.filter(r => ["REQUESTED", "ASSIGNED", "EN_ROUTE"].includes(r.status)).length;
        const arrived = records.filter(r => ["ARRIVED", "TRIAGED"].includes(r.status)).length;

        setFieldText("emergencyStatCritical", critical);
        setFieldText("emergencyStatIncoming", incoming);
        setFieldText("emergencyStatArrived", arrived);
        setFieldText("emergencyStatTotal", records.length);
        setFieldText("emergencyBadge", incoming);
    }

    async function updateStatus(newStatus) {
        if (!selectedEmergency) {
            alert("Please select an emergency arrival from the table first.");
            return;
        }

        const api = window.MedraAPI;
        if (!api) return;

        try {
            if (actionMessage) actionMessage.textContent = `Saving status to PostgreSQL...`;
            const resp = await api.patch(`/api/hospital/emergencies/${selectedEmergency.id}/status`, {
                status: newStatus,
                notes: `Status changed by hospital staff at ${new Date().toLocaleTimeString()}`
            });

            selectedEmergency.status = resp.status;
            setFieldText("selectedEmergencyStatus", resp.status);

            if (actionMessage) {
                actionMessage.textContent = `✓ Arrival marked as ${newStatus} in database.`;
                actionMessage.style.color = "#047857";
            }

            if (typeof showNotification === "function") {
                showNotification(`Emergency ${selectedEmergency.reference} status updated to ${newStatus}`, "success");
            }

            await loadEmergencies();

        } catch (err) {
            console.error("Status update error:", err);
            if (actionMessage) {
                actionMessage.textContent = `Error: ${err.message}`;
                actionMessage.style.color = "#b91c1c";
            }
        }
    }

    if (markArrivedBtn) markArrivedBtn.addEventListener("click", () => updateStatus("ARRIVED"));
    if (markReceivedBtn) markReceivedBtn.addEventListener("click", () => updateStatus("TRIAGED"));

    if (searchInput) searchInput.addEventListener("input", applyFilters);
    if (priorityFilter) priorityFilter.addEventListener("change", applyFilters);
    if (statusFilter) statusFilter.addEventListener("change", applyFilters);

    if (resetButton) {
        resetButton.addEventListener("click", () => {
            if (searchInput) searchInput.value = "";
            if (priorityFilter) priorityFilter.value = "";
            if (statusFilter) statusFilter.value = "";
            applyFilters();
        });
    }

    if (refreshButton) {
        refreshButton.addEventListener("click", async () => {
            refreshButton.disabled = true;
            await loadEmergencies();
            refreshButton.disabled = false;
            if (typeof showNotification === "function") {
                showNotification("Emergency arrivals queue refreshed", "info");
            }
        });
    }

    if (closeDetailsButton && detailsPanel) {
        closeDetailsButton.addEventListener("click", () => {
            detailsPanel.hidden = true;
            selectedEmergency = null;
        });
    }

    await loadEmergencies();
});