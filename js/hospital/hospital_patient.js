"use strict";

/* =========================================================
   MEDRA HOSPITAL - PATIENT DIRECTORY CONTROLLER
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["hospital", "admin"])) {
        return;
    }

    const tableBody = document.getElementById("directoryTableBody");
    const searchInput = document.getElementById("directorySearch");
    const statusFilter = document.getElementById("directoryStatus");
    const arrivalFilter = document.getElementById("directoryArrival");
    const resetButton = document.getElementById("directoryReset");
    const resultCount = document.getElementById("directoryResultCount");
    const emptyState = document.getElementById("directoryEmpty");

    const detailPanel = document.getElementById("directoryDetail");
    const closeDetailButton = document.getElementById("directoryCloseDetail");

    let loadedPatients = [];
    let selectedPatient = null;

    async function loadPatients() {
        const api = window.MedraAPI;
        if (!api) return;

        try {
            const query = (searchInput?.value || "").trim();
            const s = statusFilter?.value || "";
            const a = arrivalFilter?.value || "";

            let url = "/api/hospital/patients?";
            if (query) url += `query=${encodeURIComponent(query)}&`;
            if (s && s !== "all") url += `status_filter=${encodeURIComponent(s)}&`;
            if (a && a !== "all") url += `arrival_filter=${encodeURIComponent(a)}&`;

            const data = await api.get(url);
            loadedPatients = data.patients || [];

            updateStatistics(data);
            renderTable(loadedPatients);

        } catch (err) {
            console.error("Patient directory fetch error:", err);
            if (typeof showNotification === "function") {
                showNotification(err.message || "Failed to load patient directory from database.", "error");
            }
        }
    }

    function renderTable(patients) {
        if (!tableBody) return;
        tableBody.innerHTML = "";

        if (patients.length === 0) {
            if (emptyState) emptyState.hidden = false;
            if (resultCount) resultCount.textContent = "0";
            return;
        }

        if (emptyState) emptyState.hidden = true;
        if (resultCount) resultCount.textContent = patients.length;

        patients.forEach(p => {
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";

            const statusClass = p.status === "Admitted" ? "badge bg-success" : (p.status === "Registered" ? "badge bg-info text-dark" : "badge bg-warning text-dark");
            const verifyClass = p.verification_status === "Verified" ? "badge bg-success" : "badge bg-secondary";

            tr.innerHTML = `
                <td><strong>${p.reference}</strong></td>
                <td><b>${p.name}</b></td>
                <td>${p.gender || '-'} / ${p.date_of_birth ? calculateAge(p.date_of_birth) + 'y' : '-'}</td>
                <td>${p.phone || '-'}</td>
                <td><span class="badge ${p.arrival_type === 'Emergency' ? 'bg-danger' : 'bg-light text-dark border'}">${p.arrival_type}</span></td>
                <td><span class="${verifyClass}">${p.verification_status}</span></td>
                <td><span class="${statusClass}">${p.status}</span></td>
            `;

            tr.addEventListener("click", () => openDetails(p));
            tableBody.appendChild(tr);
        });
    }

    function calculateAge(dobStr) {
        try {
            const dob = new Date(dobStr);
            const diff = Date.now() - dob.getTime();
            return Math.abs(new Date(diff).getUTCFullYear() - 1970);
        } catch {
            return "-";
        }
    }

    function openDetails(p) {
        selectedPatient = p;
        if (detailPanel) detailPanel.hidden = false;

        setElText("detailReference", p.reference);
        setElText("detailName", p.name);
        setElText("detailArrival", `${p.arrival_type} (${p.arrival_method})`);
        setElText("detailStatus", `${p.status} · Priority: ${p.priority}`);

        let actionArea = document.getElementById("directoryDetailActions");
        if (!actionArea && detailPanel) {
            actionArea = document.createElement("div");
            actionArea.id = "directoryDetailActions";
            actionArea.style.marginTop = "16px";
            detailPanel.appendChild(actionArea);
        }

        if (actionArea) {
            actionArea.innerHTML = `
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-primary btn-sm" onclick="window.location.href='hospital_verification.html?ref=${p.reference}'">
                        Verify Identity / Check ABHA →
                    </button>
                </div>
            `;
        }
    }

    function setElText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text || "-";
    }

    function updateStatistics(data) {
        setElText("directoryTotal", data.total || 0);
        setElText("directoryRegistered", data.registered || 0);
        setElText("directoryPending", data.pending || 0);
        setElText("directoryEmergency", data.emergency || 0);
    }

    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener("input", () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(loadPatients, 250);
        });
    }

    if (statusFilter) statusFilter.addEventListener("change", loadPatients);
    if (arrivalFilter) arrivalFilter.addEventListener("change", loadPatients);

    if (resetButton) {
        resetButton.addEventListener("click", () => {
            if (searchInput) searchInput.value = "";
            if (statusFilter) statusFilter.value = "";
            if (arrivalFilter) arrivalFilter.value = "";
            loadPatients();
        });
    }

    if (closeDetailButton && detailPanel) {
        closeDetailButton.addEventListener("click", () => {
            detailPanel.hidden = true;
            selectedPatient = null;
        });
    }

    await loadPatients();
});