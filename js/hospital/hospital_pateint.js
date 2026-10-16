"use strict";

document.addEventListener("DOMContentLoaded", () => {
    // ==========================================
    // 1. GET HTML ELEMENTS
    // ==========================================
    const tableBody = document.getElementById("directoryTableBody");
    const searchInput = document.getElementById("directorySearch");
    const statusFilter = document.getElementById("directoryStatus");
    const arrivalFilter = document.getElementById("directoryArrival");
    const resetButton = document.getElementById("directoryReset");
    const resultCount = document.getElementById("directoryResultCount");
    const emptyState = document.getElementById("directoryEmpty");

    const detailPanel = document.getElementById("directoryDetail");
    const closeDetailButton = document.getElementById("directoryCloseDetail");

    const themeSelect = document.getElementById("hospitalThemeSelect");
    const sidebar = document.getElementById("hospitalSidebar");
    const menuButton = document.getElementById("hospitalMenuButton");

    // Check that the essential directory elements exist.
    if (
        !tableBody ||
        !searchInput ||
        !statusFilter ||
        !arrivalFilter ||
        !resetButton ||
        !resultCount ||
        !emptyState
    ) {
        console.error(
            "Hospital directory: One or more required HTML element IDs are missing. Check hospital-patients.html."
        );
        return;
    }

    // ==========================================
    // 2. DEMO PATIENT RECORDS
    // Fictional records for frontend testing only.
    // ==========================================
    const demoPatients = [
        {
            reference: "MEDRA-DEMO-001",
            name: "Demo Patient One",
            arrival: "Routine",
            status: "Registered",
            review: "Reviewed"
        },
        {
            reference: "MEDRA-DEMO-002",
            name: "Demo Patient Two",
            arrival: "Emergency",
            status: "Emergency",
            review: "Pending"
        },
        {
            reference: "MEDRA-DEMO-003",
            name: "Demo Patient Three",
            arrival: "Routine",
            status: "Pending review",
            review: "Pending"
        },
        {
            reference: "MEDRA-DEMO-004",
            name: "Demo Patient Four",
            arrival: "Routine",
            status: "Registered",
            review: "Reviewed"
        }
    ];

    // ==========================================
    // 3. CREATE SAFE TABLE ELEMENTS
    // ==========================================
    function createCell(text) {
        const cell = document.createElement("td");
        cell.textContent = text;
        return cell;
    }

    function createStatus(text) {
        const span = document.createElement("span");
        span.className = "directory-status";
        span.textContent = text;
        return span;
    }

    // ==========================================
    // 4. UPDATE STATISTICS
    // Statistics show the currently filtered records.
    // ==========================================
    function updateStatistics(records) {
        const total = document.getElementById("directoryTotal");
        const registered = document.getElementById("directoryRegistered");
        const pending = document.getElementById("directoryPending");
        const emergency = document.getElementById("directoryEmergency");

        if (total) {
            total.textContent = records.length;
        }

        if (registered) {
            registered.textContent = records.filter(
                patient => patient.status === "Registered"
            ).length;
        }

        if (pending) {
            pending.textContent = records.filter(
                patient => patient.status === "Pending review"
            ).length;
        }

        if (emergency) {
            emergency.textContent = records.filter(
                patient => patient.arrival === "Emergency"
            ).length;
        }
    }

    // ==========================================
    // 5. OPEN PATIENT SUMMARY
    // ==========================================
    function openDetails(patient) {
        const reference = document.getElementById("detailReference");
        const name = document.getElementById("detailName");
        const arrival = document.getElementById("detailArrival");
        const status = document.getElementById("detailStatus");

        if (!detailPanel) {
            return;
        }

        if (reference) reference.textContent = patient.reference;
        if (name) name.textContent = patient.name;
        if (arrival) arrival.textContent = patient.arrival;
        if (status) status.textContent = patient.status;

        detailPanel.hidden = false;

        detailPanel.scrollIntoView({
            behavior: "smooth",
            block: "nearest"
        });
    }

    // ==========================================
    // 6. FILTER AND RENDER PATIENTS
    // ==========================================
    function renderPatients() {
        const query = searchInput.value.trim().toLowerCase();
        const selectedStatus = statusFilter.value;
        const selectedArrival = arrivalFilter.value;

        const filteredPatients = demoPatients.filter(patient => {
            const matchesSearch =
                patient.reference.toLowerCase().includes(query) ||
                patient.name.toLowerCase().includes(query) ||
                patient.arrival.toLowerCase().includes(query);

            const matchesStatus =
                selectedStatus === "all" ||
                patient.status === selectedStatus;

            const matchesArrival =
                selectedArrival === "all" ||
                patient.arrival === selectedArrival;

            return matchesSearch && matchesStatus && matchesArrival;
        });

        // Remove old rows.
        tableBody.replaceChildren();

        // Add matching records.
        filteredPatients.forEach(patient => {
            const row = document.createElement("tr");

            const referenceCell = document.createElement("td");
            const referenceButton = document.createElement("button");

            referenceButton.type = "button";
            referenceButton.className = "directory-reference-btn";
            referenceButton.textContent = patient.reference;
            referenceButton.setAttribute(
                "aria-label",
                `View demo summary for ${patient.reference}`
            );

            referenceButton.addEventListener("click", () => {
                openDetails(patient);
            });

            referenceCell.appendChild(referenceButton);
            row.appendChild(referenceCell);

            row.appendChild(createCell(patient.name));
            row.appendChild(createCell(patient.arrival));

            const statusCell = document.createElement("td");
            statusCell.appendChild(createStatus(patient.status));
            row.appendChild(statusCell);

            const reviewCell = document.createElement("td");
            reviewCell.appendChild(createStatus(patient.review));
            row.appendChild(reviewCell);

            tableBody.appendChild(row);
        });

        // Display the empty state when no records match.
        emptyState.hidden = filteredPatients.length > 0;

        // Update the result message.
        resultCount.textContent =
            `Showing ${filteredPatients.length} of ${demoPatients.length} demo records`;

        // Update summary cards.
        updateStatistics(filteredPatients);
    }

    // ==========================================
    // 7. SEARCH AND FILTER EVENTS
    // ==========================================
    searchInput.addEventListener("input", renderPatients);
    statusFilter.addEventListener("change", renderPatients);
    arrivalFilter.addEventListener("change", renderPatients);

    // ==========================================
    // 8. RESET BUTTON — CORRECTED
    // ==========================================
    resetButton.addEventListener("click", event => {
        event.preventDefault();

        // Clear the search field.
        searchInput.value = "";

        // Restore the default filter options.
        statusFilter.value = "all";
        arrivalFilter.value = "all";

        // Close the patient details panel.
        if (detailPanel) {
            detailPanel.hidden = true;
        }

        // Re-render all four demo records and refresh statistics.
        renderPatients();

        // Return keyboard focus to the search field.
        searchInput.focus();
    });

    // ==========================================
    // 9. CLOSE PATIENT SUMMARY
    // ==========================================
    closeDetailButton?.addEventListener("click", () => {
        if (detailPanel) {
            detailPanel.hidden = true;
        }
    });

    // ==========================================
    // 10. APPEARANCE: SYSTEM / LIGHT / DARK
    // ==========================================
    function applyTheme(theme) {
        const darkMode =
            theme === "dark" ||
            (
                theme === "system" &&
                window.matchMedia("(prefers-color-scheme: dark)").matches
            );

        document.documentElement.dataset.theme =
            darkMode ? "dark" : "light";

        document.body.classList.toggle("dark", darkMode);

        if (themeSelect) {
            themeSelect.value = theme;
        }
    }

    let savedTheme = "system";

    try {
        savedTheme = localStorage.getItem("medra_theme") || "system";
    } catch (error) {
        console.warn("Could not read the saved appearance preference.");
    }

    if (!["system", "light", "dark"].includes(savedTheme)) {
        savedTheme = "system";
    }

    applyTheme(savedTheme);

    themeSelect?.addEventListener("change", () => {
        const selectedTheme = themeSelect.value;

        applyTheme(selectedTheme);

        try {
            localStorage.setItem("medra_theme", selectedTheme);
        } catch (error) {
            console.warn("Could not save the appearance preference.");
        }
    });

    const systemTheme = window.matchMedia(
        "(prefers-color-scheme: dark)"
    );

    systemTheme.addEventListener("change", () => {
        if (themeSelect?.value === "system") {
            applyTheme("system");
        }
    });

    // ==========================================
    // 11. MOBILE SIDEBAR
    // ==========================================
    menuButton?.addEventListener("click", () => {
        if (!sidebar) {
            return;
        }

        const isOpen = sidebar.classList.toggle("sidebar-open");

        menuButton.setAttribute("aria-expanded", String(isOpen));
    });

    // ==========================================
    // 12. INITIAL PAGE RENDER
    // ==========================================
    renderPatients();

    console.log("MEDRA hospital patient directory initialized.");
});