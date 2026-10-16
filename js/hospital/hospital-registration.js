"use strict";

/* =========================================================
   MEDRA HOSPITAL - PATIENT REGISTRATION CONTROLLER
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["hospital", "admin"])) {
        return;
    }

    const form = document.getElementById("registrationForm");
    const messageBox = document.getElementById("registrationMessage");
    const previewPanel = document.getElementById("previewPanel");
    const previewContainer = document.getElementById("registrationPreview");
    const resetButton = document.getElementById("resetRegistration");
    const themeSelect = document.getElementById("hospitalThemeSelect");

    function readValue(id) {
        return (document.getElementById(id)?.value || "").trim();
    }

    function showMessage(msg, type = "info") {
        if (!messageBox) return;
        messageBox.textContent = msg;
        messageBox.style.display = "block";
        messageBox.className = `registration-message ${type}`;
    }

    function clearMessage() {
        if (!messageBox) return;
        messageBox.textContent = "";
        messageBox.style.display = "none";
    }

    function addPreviewItem(label, value) {
        const item = document.createElement("div");
        item.className = "preview-item";

        const title = document.createElement("span");
        title.textContent = label;

        const content = document.createElement("strong");
        content.textContent = value || "Not provided";

        item.append(title, content);
        previewContainer.appendChild(item);
    }

    function validateRegistration() {
        const firstName = readValue("firstName");
        const lastName = readValue("lastName");
        const arrivalType = readValue("arrivalType");
        const arrivalDate = readValue("arrivalDate");
        const arrivalTime = readValue("arrivalTime");
        const email = readValue("email");
        const phone = readValue("phone");
        const dob = readValue("dateOfBirth");

        if (!firstName || !lastName) {
            return "Enter the patient's first and last names.";
        }

        if (!arrivalType || !arrivalDate || !arrivalTime) {
            return "Complete all required arrival fields.";
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return "Enter a valid email address.";
        }

        if (phone && !/^[0-9+()\-\s]{7,20}$/.test(phone)) {
            return "Check the contact number format.";
        }

        const confirmCheck = document.getElementById("informationConfirmed");
        if (confirmCheck && !confirmCheck.checked) {
            return "Confirm the entered information before saving.";
        }

        return "";
    }

    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearMessage();

            const validationError = validateRegistration();
            if (validationError) {
                if (previewPanel) previewPanel.hidden = true;
                showMessage(validationError, "error");
                return;
            }

            const submitBtn = form.querySelector("button[type='submit']");
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = "Saving to PostgreSQL Database...";
            }

            const payload = {
                first_name: readValue("firstName"),
                last_name: readValue("lastName"),
                date_of_birth: readValue("dateOfBirth") || null,
                gender: document.getElementById("gender")?.value || "Not specified",
                phone: readValue("phone") || null,
                email: readValue("email") || null,
                arrival_type: document.getElementById("arrivalType")?.value || "Emergency",
                arrival_method: document.getElementById("arrivalMethod")?.value || "Ambulance",
                arrival_date: readValue("arrivalDate"),
                arrival_time: readValue("arrivalTime"),
                priority: document.getElementById("priority")?.value || "Critical",
                referral_source: readValue("referralSource") || "Direct Arrival",
                notes: readValue("registrationNotes") || ""
            };

            try {
                const api = window.MedraAPI;
                const result = await api.post("/api/hospital/patients", payload);

                // Populate preview
                if (previewContainer) {
                    previewContainer.replaceChildren();
                    addPreviewItem("System Reference ID", result.reference);
                    addPreviewItem("Full Name", result.name);
                    addPreviewItem("Initial Priority", payload.priority);
                    addPreviewItem("Arrival Type", payload.arrival_type);
                    addPreviewItem("Arrival Method", payload.arrival_method);
                    addPreviewItem("Verification Status", result.verification_status);
                    addPreviewItem("Clinical Status", result.status);
                    addPreviewItem("Database Storage", "PostgreSQL (hospital_patients)");
                }

                if (previewPanel) {
                    previewPanel.hidden = false;
                    previewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
                }

                showMessage(`✓ Patient registered successfully! Permanent Reference: ${result.reference}. Record persisted in PostgreSQL.`, "success");
                if (typeof showNotification === "function") {
                    showNotification(`Patient record ${result.reference} saved to PostgreSQL`, "success");
                }

                // Add quick action buttons to preview
                let actionDiv = document.getElementById("postRegistrationActions");
                if (!actionDiv) {
                    actionDiv = document.createElement("div");
                    actionDiv.id = "postRegistrationActions";
                    actionDiv.style.marginTop = "20px";
                    actionDiv.style.display = "flex";
                    actionDiv.style.gap = "12px";
                    previewPanel.appendChild(actionDiv);
                }

                actionDiv.innerHTML = `
                    <button class="btn btn-primary" onclick="window.location.href='hospital_verification.html?ref=${result.reference}'">
                        Proceed to Verify Patient Identity →
                    </button>
                    <button class="btn btn-secondary" onclick="window.location.href='hospital_patient.html'">
                        View Patient Directory
                    </button>
                `;

            } catch (err) {
                console.error("Patient registration error:", err);
                showMessage(err.message || "Failed to save registration to database.", "error");
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Register Patient";
                }
            }
        });
    }

    if (resetButton && form) {
        resetButton.addEventListener("click", () => {
            form.reset();
            clearMessage();
            if (previewPanel) previewPanel.hidden = true;
        });
    }
});