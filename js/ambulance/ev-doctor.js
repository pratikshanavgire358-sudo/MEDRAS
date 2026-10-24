"use strict";

let doctorEmergencies = [];
let selectedEmergencyId = null;
let doctorDashboardLoading = false;

const doctorById = id => document.getElementById(id);

 document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["ambulance"])) return;

    const user = window.MedraAPI?.getCurrentUser();
    if (user?.ambulance_subrole !== "EV_DOCTOR") {
        showDoctorMessage("This account is not assigned the EV Doctor subrole.", "error");
        return;
    }

    bindDoctorControls();
    doctorById("currentDate").textContent = new Date().toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
    });
    doctorById("doctorSidebarName").textContent = user.full_name || "EV Doctor";
    doctorById("welcomeDoctorName").textContent = user.full_name || "Doctor";
    doctorById("doctorNameInput").value = user.full_name || "";
    doctorById("doctorHospital").value = "Assigned ambulance unit";
    await loadDoctorDashboard();
    window.setInterval(loadDoctorDashboard, 10000);
});

function bindDoctorControls() {
    document.querySelectorAll(".nav-link[data-page]").forEach(button => {
        button.addEventListener("click", () => showDoctorPage(button.dataset.page));
    });
    document.querySelectorAll("[data-goto]").forEach(button => {
        button.addEventListener("click", () => showDoctorPage(button.dataset.goto));
    });
    document.addEventListener("click", event => {
        const button = event.target.closest("[data-action='review']");
        if (button) selectDoctorEmergency(Number(button.dataset.id));
    });

    doctorById("viewEmergenciesButton").addEventListener("click", () => showDoctorPage("emergencies"));
    doctorById("saveAssessmentButton").addEventListener("click", saveDoctorAssessment);
    doctorById("requestAmbulanceButton").addEventListener("click", () => showDoctorPage("ambulances"));
    doctorById("refreshButton").addEventListener("click", loadDoctorDashboard);
    doctorById("resetDemoButton").addEventListener("click", loadDoctorDashboard);
    doctorById("patientSearch").addEventListener("input", renderDoctorDirectory);
    doctorById("menuButton").addEventListener("click", () => doctorById("sidebar").classList.toggle("open"));
    doctorById("logoutButton").addEventListener("click", () => window.logoutMedra?.());

    doctorById("saveProfileButton").disabled = true;
    doctorById("saveProfileButton").hidden = true;
    doctorById("doctorSpecialty").value = "EV Doctor";
}

async function loadDoctorDashboard() {
    if (doctorDashboardLoading || !window.MedraAPI) return;
    doctorDashboardLoading = true;
    try {
        const data = await window.MedraAPI.get("/api/ambulance/doctor/emergencies");
        doctorEmergencies = data.emergencies || [];
        renderDoctorDashboard(data.unit);
    } catch (error) {
        showDoctorMessage(error.message || "Unable to load assigned emergencies.", "error");
    } finally {
        doctorDashboardLoading = false;
    }
}

function renderDoctorDashboard(unit) {
    doctorById("online");
    const onlineText = document.querySelector(".online");
    if (onlineText) onlineText.lastChild.textContent = " CONNECTED";

    doctorById("activeCasesCount").textContent = doctorEmergencies.length;
    doctorById("assessedCount").textContent = doctorEmergencies.reduce(
        (total, emergency) => total + (emergency.assessments || []).length,
        0
    );
    doctorById("availableAmbulancesCount").textContent = unit?.vehicle_number || "—";
    doctorById("linkedUnitStatus").textContent = unit?.status || "No linked unit";
    doctorById("criticalCasesCount").textContent = doctorEmergencies.filter(
        emergency => emergency.priority === "CRITICAL"
    ).length;
    doctorById("navEmergencyCount").textContent = doctorEmergencies.length;

    renderEmergencyList("overviewCaseList", doctorEmergencies.slice(0, 3));
    renderEmergencyList("allCaseList", doctorEmergencies);
    renderDoctorDirectory();
    renderAssessments();
    renderUnit(unit);
    renderRecentAssessments();

    if (selectedEmergencyId && !doctorEmergencies.some(item => item.emergency_id === selectedEmergencyId)) {
        selectedEmergencyId = null;
        doctorById("patientDetail").classList.remove("visible");
        doctorById("noPatientSelected").style.display = "block";
    }
}

function renderEmergencyList(elementId, emergencies) {
    const container = doctorById(elementId);
    if (!container) return;
    container.innerHTML = emergencies.map(renderEmergencyCard).join("") ||
        '<div class="empty-state">No active emergencies are assigned to this ambulance.</div>';
}

function renderEmergencyCard(emergency) {
    const id = Number(emergency.emergency_id);
    const patientName = emergency.patient_name || "Patient";
    return `
        <article class="case-card ${selectedEmergencyId === id ? "selected" : ""}">
            <div class="case-top">
                <div class="patient-info">
                    <div class="patient-avatar">${escapeDoctorHtml(patientName.slice(0, 1).toUpperCase())}</div>
                    <div>
                        <strong>${escapeDoctorHtml(patientName)}</strong>
                        <small>${escapeDoctorHtml(emergency.reference)} · ${escapeDoctorHtml(emergency.status)}</small>
                    </div>
                </div>
                <span class="severity ${priorityClass(emergency.priority)}">${escapeDoctorHtml(emergency.priority)}</span>
            </div>
            <div class="case-meta">
                <span>${escapeDoctorHtml(emergency.emergency_type)}</span>
                <span>${escapeDoctorHtml(formatDoctorLocation(emergency.pickup_latitude, emergency.pickup_longitude))}</span>
            </div>
            <p class="case-description">${escapeDoctorHtml(emergency.description || "No reported details.")}</p>
            <div class="case-actions">
                <button class="button button-primary" data-action="review" data-id="${id}">Review Case</button>
                <span class="tag">${escapeDoctorHtml(emergency.assignment_status)}</span>
            </div>
        </article>
    `;
}

function selectDoctorEmergency(emergencyId) {
    const emergency = doctorEmergencies.find(item => item.emergency_id === emergencyId);
    if (!emergency) return;
    selectedEmergencyId = emergencyId;
    doctorById("patientDetail").classList.add("visible");
    doctorById("noPatientSelected").style.display = "none";
    doctorById("detailAvatar").textContent = (emergency.patient_name || "P").slice(0, 1).toUpperCase();
    doctorById("detailName").textContent = emergency.patient_name || "Patient";
    doctorById("detailId").textContent = `${emergency.reference} · ${emergency.status}`;
    doctorById("detailSymptoms").textContent = emergency.description || emergency.emergency_type;
    doctorById("detailLocation").textContent = formatDoctorLocation(emergency.pickup_latitude, emergency.pickup_longitude);
    doctorById("detailAllergies").textContent = "No allergy field exists in the current emergency record.";
    doctorById("severitySelect").value = emergency.priority || "NORMAL";
    doctorById("assessmentNotes").value = "";
    renderEmergencyVitals(emergency.vitals || []);
    renderEmergencyList("allCaseList", doctorEmergencies);
    showDoctorPage("emergencies");
}

function renderEmergencyVitals(vitals) {
    const latest = vitals[0];
    if (!latest) {
        doctorById("vitalsGrid").innerHTML = '<div class="empty-state">No vitals are linked to this emergency.</div>';
        return;
    }
    const values = [
        ["Heart Rate", latest.heart_rate, "bpm"],
        ["SpO2", latest.sp_o2, "%"],
        ["Blood Pressure", latest.blood_pressure_systolic && latest.blood_pressure_diastolic
            ? `${latest.blood_pressure_systolic}/${latest.blood_pressure_diastolic}` : null, "mmHg"],
        ["Temperature", latest.temperature, "°C"],
        ["Respiratory Rate", latest.respiratory_rate, "/min"]
    ];
    doctorById("vitalsGrid").innerHTML = values.map(([label, value, unit]) => `
        <div class="vital-card">
            <div class="vital-label">${label}</div>
            <div class="vital-value">${value == null ? "—" : escapeDoctorHtml(value)} <span class="vital-unit">${unit}</span></div>
            <div class="vital-status">${latest.recorded_at ? escapeDoctorHtml(new Date(latest.recorded_at).toLocaleString()) : ""}</div>
        </div>
    `).join("");
}

async function saveDoctorAssessment() {
    const emergency = doctorEmergencies.find(item => item.emergency_id === selectedEmergencyId);
    const button = doctorById("saveAssessmentButton");
    const notes = doctorById("assessmentNotes").value.trim();
    if (!emergency) return showDoctorMessage("Select an assigned emergency first.", "warning");
    if (!notes) return showDoctorMessage("Enter assessment notes before saving.", "warning");

    button.disabled = true;
    button.textContent = "Saving assessment...";
    try {
        await window.MedraAPI.post(`/api/ambulance/doctor/emergencies/${emergency.emergency_id}/assessment`, {
            priority: doctorById("severitySelect").value,
            notes,
            next_step: doctorById("treatmentSelect").value
        });
        doctorById("assessmentNotes").value = "";
        showDoctorMessage("Assessment saved to the emergency record.", "success");
        await loadDoctorDashboard();
        selectDoctorEmergency(emergency.emergency_id);
    } catch (error) {
        showDoctorMessage(error.message || "Unable to save assessment.", "error");
    } finally {
        button.disabled = false;
        button.textContent = "Save Assessment";
    }
}

function renderDoctorDirectory() {
    const container = doctorById("patientDirectory");
    if (!container) return;
    const search = (doctorById("patientSearch").value || "").trim().toLowerCase();
    const matching = doctorEmergencies.filter(emergency =>
        `${emergency.patient_name || ""} ${emergency.reference} ${emergency.emergency_type}`.toLowerCase().includes(search)
    );
    renderEmergencyList("patientDirectory", matching);
}

function renderAssessments() {
    const assessments = doctorEmergencies.flatMap(emergency => (emergency.assessments || []).map(assessment => ({
        ...assessment,
        reference: emergency.reference,
        patient_name: emergency.patient_name,
        priority: emergency.priority
    })));
    const container = doctorById("notesList");
    container.innerHTML = assessments.map(item => `
        <article class="case-card">
            <div class="case-top">
                <div>
                    <strong>${escapeDoctorHtml(item.patient_name || "Patient")}</strong>
                    <div class="case-meta">${escapeDoctorHtml(item.reference)} · ${item.created_at ? escapeDoctorHtml(new Date(item.created_at).toLocaleString()) : ""}</div>
                </div>
                <span class="severity ${priorityClass(item.priority)}">${escapeDoctorHtml(item.priority)}</span>
            </div>
            <p class="case-description">${escapeDoctorHtml(item.notes)}</p>
            ${item.next_step ? `<p class="case-description"><strong>Next step:</strong> ${escapeDoctorHtml(item.next_step)}</p>` : ""}
        </article>
    `).join("") || '<div class="empty-state">No saved clinical assessments for active assignments.</div>';
}

function renderUnit(unit) {
    const markup = unit ? `
        <div class="resource-item">
            <div class="resource-icon">🚑</div>
            <div class="resource-info">
                <strong>${escapeDoctorHtml(unit.vehicle_number)}</strong>
                <small>Ambulance ${Number(unit.ambulance_id)}</small>
            </div>
            <span class="resource-status">${escapeDoctorHtml(unit.status)}</span>
        </div>
    ` : '<div class="empty-state">No ambulance is linked to this account.</div>';
    doctorById("resourceList").innerHTML = markup;
    doctorById("ambulanceDirectory").innerHTML = markup;
    doctorById("assignmentSummary").textContent = unit
        ? `${unit.vehicle_number} · ${unit.status}. Hospital details are shown on each active assignment.`
        : "No active ambulance assignment.";
}

function renderRecentAssessments() {
    const latest = doctorEmergencies.flatMap(emergency => (emergency.assessments || []).map(assessment => ({
        ...assessment,
        reference: emergency.reference
    }))).slice(0, 5);
    doctorById("activityList").innerHTML = latest.map(item => `
        <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div><strong>${escapeDoctorHtml(item.reference)} assessment</strong><p>${escapeDoctorHtml(item.notes)}</p></div>
        </div>
    `).join("") || '<div class="empty-state">No recent assessments.</div>';
}

function showDoctorPage(page) {
    document.querySelectorAll(".page-section").forEach(section => {
        section.classList.toggle("active", section.id === `page-${page}`);
    });
    document.querySelectorAll(".nav-link[data-page]").forEach(button => {
        button.classList.toggle("active", button.dataset.page === page);
    });
    const titles = {
        overview: "Doctor Dashboard",
        emergencies: "Emergency Cases",
        patients: "Assigned Patient Records",
        ambulances: "Ambulance Assignment",
        notes: "Clinical Notes",
        profile: "Doctor Profile"
    };
    doctorById("topbarTitle").textContent = titles[page] || "Doctor Dashboard";
    doctorById("sidebar").classList.remove("open");
}

function showDoctorMessage(message, type = "info") {
    const toast = doctorById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    toast.setAttribute("data-type", type);
    clearTimeout(showDoctorMessage.timer);
    showDoctorMessage.timer = window.setTimeout(() => toast.classList.remove("show"), 4000);
}

function priorityClass(priority) {
    return ({ CRITICAL: "severity-critical", HIGH: "severity-high", NORMAL: "severity-medium", LOW: "tag" })[priority] || "tag";
}

function formatDoctorLocation(latitude, longitude) {
    if (latitude == null || longitude == null) return "Location not provided";
    return `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`;
}

function escapeDoctorHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}
