"use strict";

/* =========================================================
   MEDRA HOSPITAL - PATIENT VERIFICATION CONTROLLER
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["hospital", "admin"])) {
        return;
    }

    const searchForm = document.getElementById("verificationSearchForm");
    const referenceInput = document.getElementById("patientReference");
    const methodSelect = document.getElementById("verificationMethod");

    const searchMessage = document.getElementById("verificationSearchMessage");
    const emptyState = document.getElementById("verificationEmptyState");
    const resultPanel = document.getElementById("verificationResult");
    const reviewButton = document.getElementById("reviewVerificationButton");

    let currentPatient = null;

    function setMessage(message, isError = false) {
        if (!searchMessage) return;
        searchMessage.textContent = message;
        searchMessage.style.color = isError ? "#b91c1c" : "#047857";
    }

    function resetChecklist() {
        const c1 = document.getElementById("checkRegistration");
        const c2 = document.getElementById("checkIdentity");
        const c3 = document.getElementById("checkAuthorization");
        if (c1) c1.checked = false;
        if (c2) c2.checked = false;
        if (c3) c3.checked = false;
    }

    function showPatientData(patient) {
        currentPatient = patient;

        setElText("resultPatientName", patient.name);
        setElText("resultPatientReference", patient.reference);
        setElText("resultReference", patient.reference);
        setElText("resultIdentityStatus", patient.verification_status);
        setElText("resultRegistrationStatus", `Status: ${patient.status} · Priority: ${patient.priority}`);

        if (emptyState) emptyState.hidden = true;
        if (resultPanel) resultPanel.hidden = false;

        if (reviewButton) {
            if (patient.verification_status === "Verified") {
                reviewButton.disabled = true;
                reviewButton.textContent = "✓ Identity Already Verified in PostgreSQL";
            } else {
                reviewButton.disabled = false;
                reviewButton.textContent = "Complete Official Verification & Save";
            }
        }

        resetChecklist();
    }

    function setElText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text || "-";
    }

    // Auto-search if ref param is present
    const urlParams = new URLSearchParams(window.location.search);
    const refParam = urlParams.get("ref");
    if (refParam && referenceInput) {
        referenceInput.value = refParam;
        performSearch(refParam);
    }

    async function performSearch(ref) {
        if (!ref) return;
        setMessage("Searching PostgreSQL database...");

        const api = window.MedraAPI;
        if (!api) return;

        try {
            const data = await api.get(`/api/hospital/patients?query=${encodeURIComponent(ref)}`);
            const patients = data.patients || [];

            if (patients.length === 0) {
                if (resultPanel) resultPanel.hidden = true;
                if (emptyState) emptyState.hidden = false;
                setMessage(`No patient found matching reference "${ref}". Check patient registration.`, true);
                return;
            }

            showPatientData(patients[0]);
            setMessage(`Patient record located in PostgreSQL. Complete checklist to verify identity.`);

        } catch (err) {
            console.error("Verification search error:", err);
            setMessage(err.message || "Failed to search patient records.", true);
        }
    }

    if (searchForm) {
        searchForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const ref = referenceInput ? referenceInput.value.trim().toUpperCase() : "";
            const method = methodSelect ? methodSelect.value : "";

            if (!ref) {
                setMessage("Please enter a patient reference (e.g. MEDRA-PAT-0001).", true);
                return;
            }

            if (method === "abha") {
                setMessage("ABDM / ABHA official verification boundary is active. Querying local patient index...", false);
            }

            performSearch(ref);
        });
    }

    if (reviewButton) {
        reviewButton.addEventListener("click", async () => {
            if (!currentPatient) {
                setMessage("Please search for and select a patient first.", true);
                return;
            }

            const c1 = document.getElementById("checkRegistration")?.checked;
            const c2 = document.getElementById("checkIdentity")?.checked;
            const c3 = document.getElementById("checkAuthorization")?.checked;

            if (!c1 || !c2 || !c3) {
                setMessage("Please review and check all 3 verification checklist items before confirming.", true);
                return;
            }

            reviewButton.disabled = true;
            reviewButton.textContent = "Recording Verification in Database...";

            try {
                const api = window.MedraAPI;
                const resp = await api.post(`/api/hospital/patients/${currentPatient.id}/verify`, {
                    verification_status: "Verified",
                    notes: "Checklist completed by hospital staff. Government photo ID & triage status confirmed."
                });

                currentPatient.verification_status = "Verified";
                setElText("resultIdentityStatus", "Verified");
                setMessage(`✓ Patient ${resp.reference} successfully verified by ${resp.verified_by}! Persisted in PostgreSQL.`, false);

                reviewButton.textContent = "✓ Identity Verified in PostgreSQL";
                if (typeof showNotification === "function") {
                    showNotification(`Patient ${resp.reference} verified successfully!`, "success");
                }

            } catch (err) {
                console.error("Verification error:", err);
                setMessage(err.message || "Unable to save verification status.", true);
                reviewButton.disabled = false;
                reviewButton.textContent = "Complete Official Verification & Save";
            }
        });
    }
});