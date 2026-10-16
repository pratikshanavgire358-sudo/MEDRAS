/* =========================================================
   MEDRA - Patient Profile Management
   ========================================================= */

"use strict";

document.addEventListener("DOMContentLoaded", () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["patient", "admin"])) {
        return;
    }

    const profileForm = document.getElementById("profileForm");
    const reloadButton = document.getElementById("reloadButton");

    if (profileForm) {
        profileForm.addEventListener("submit", savePatientProfile);
    }

    if (reloadButton) {
        reloadButton.addEventListener("click", loadPatientProfile);
    }

    loadPatientProfile();
});

function showMessage(text, type = "info") {
    const message = document.getElementById("message");
    if (!message) return;
    message.textContent = text;
    message.className = `alert alert-${type}`;
    message.style.display = "block";
}

function setField(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value || "";
}

async function loadPatientProfile() {
    const api = window.MedraAPI;
    if (!api || !api.getToken()) {
        showMessage("Login session not found. Please log in first.", "warning");
        return;
    }

    showMessage("Loading your patient profile...", "info");

    try {
        const data = await api.get("/api/patient/profile");

        setField("fullName", data.full_name);
        setField("email", data.email);
        setField("mobile", data.mobile);
        setField("dateOfBirth", data.date_of_birth);
        setField("gender", data.gender);
        setField("bloodGroup", data.blood_group);
        setField("address", data.address);
        setField("emergencyContactName", data.emergency_contact_name);
        setField("emergencyContactMobile", data.emergency_contact_mobile);

        const abhaEl = document.getElementById("abhaStatus");
        if (abhaEl) {
            abhaEl.textContent = data.abha_linked
                ? "ABHA connection: Linked (Demonstration Mode)"
                : "ABHA connection: Not connected (ABDM sandbox ready)";
            abhaEl.className = data.abha_linked ? "text-success fw-bold" : "text-muted";
        }

        showMessage("Profile loaded successfully.", "success");
    } catch (err) {
        console.error("Profile load error:", err);
        showMessage(err.message || "Failed to load patient profile.", "danger");
    }
}

async function savePatientProfile(e) {
    e.preventDefault();
    const api = window.MedraAPI;
    const saveBtn = document.getElementById("saveProfileButton");

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving to PostgreSQL...";
    }

    const payload = {
        date_of_birth: document.getElementById("dateOfBirth")?.value || null,
        gender: document.getElementById("gender")?.value || null,
        blood_group: document.getElementById("bloodGroup")?.value || null,
        address: document.getElementById("address")?.value || null,
        emergency_contact_name: document.getElementById("emergencyContactName")?.value || null,
        emergency_contact_mobile: document.getElementById("emergencyContactMobile")?.value || null
    };

    try {
        const updated = await api.put("/api/patient/profile", payload);
        showMessage("Patient profile saved successfully to PostgreSQL database!", "success");
        if (typeof showNotification === "function") {
            showNotification("Patient profile updated successfully", "success");
        }
    } catch (err) {
        console.error("Save profile error:", err);
        showMessage(err.message || "Unable to save profile.", "danger");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Profile";
        }
    }
}
