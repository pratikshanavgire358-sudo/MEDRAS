/* =========================================================
   MEDRA - Patient Profile Management
   Frontend: JavaScript
   Backend: FastAPI
   Database: PostgreSQL
   Authentication: JWT
   ========================================================= */

const API_URL = "http://127.0.0.1:8000";

document.addEventListener("DOMContentLoaded", () => {
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

/* =========================================================
   Authentication Helpers
   ========================================================= */

function getAuthToken() {
    return sessionStorage.getItem("medra_access_token");
}

function getSavedUser() {
    try {
        const savedUser = sessionStorage.getItem("medra_user");
        return savedUser ? JSON.parse(savedUser) : null;
    } catch (error) {
        console.error("Unable to read saved user:", error);
        return null;
    }
}

function showMessage(text, type = "info") {
    const message = document.getElementById("message");

    if (!message) return;

    message.textContent = text;
    message.className = `alert alert-${type}`;
}

/* =========================================================
   Load Patient Profile
   ========================================================= */

async function loadPatientProfile() {
    const token = getAuthToken();

    // Do not redirect immediately; show why the profile cannot load.
    if (!token) {
        showMessage(
            "Login session not found. Please log in first.",
            "warning"
        );
        return;
    }

    // Display basic account information saved during login.
    const user = getSavedUser();

    if (user) {
        setField("fullName", user.full_name);
        setField("email", user.email);
        setField("mobile", user.mobile);
    }

    showMessage("Loading your patient profile...", "info");

    try {
        const response = await fetch(`${API_URL}/api/patient/profile`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/json"
            }
        });

        const result = await response.json().catch(() => ({}));

        if (response.status === 401) {
            showMessage(
                "Your session is invalid or expired. Please log in again.",
                "danger"
            );
            return;
        }

        if (!response.ok) {
            throw new Error(
                result.detail ||
                `Unable to load patient profile. HTTP ${response.status}`
            );
        }

        // Support either a nested user object or top-level user fields.
        const profileUser = result.user || result;

        setField("fullName", profileUser.full_name);
        setField("email", profileUser.email);
        setField("mobile", profileUser.mobile);

        // Additional patient information.
        setField("dateOfBirth", result.date_of_birth);
        setField("gender", result.gender);
        setField("bloodGroup", result.blood_group);
        setField("address", result.address);
        setField("emergencyName", result.emergency_contact_name);
        setField("emergencyMobile", result.emergency_contact_mobile);

        const abhaStatus = document.getElementById("abhaStatus");

        if (abhaStatus) {
            abhaStatus.textContent = result.abha_linked
                ? "ABHA linked"
                : "ABHA not linked";
        }

        showMessage("Patient profile loaded successfully.", "success");

    } catch (error) {
        console.error("Patient profile loading error:", error);

        showMessage(
            "Unable to connect to the MEDRA server. Check that FastAPI is running.",
            "danger"
        );
    }
}

/* =========================================================
   Save Patient Profile
   ========================================================= */

async function savePatientProfile(event) {
    event.preventDefault();

    const token = getAuthToken();

    if (!token) {
        showMessage(
            "Login session not found. Please log in before saving.",
            "danger"
        );
        return;
    }

    const profileData = {
        date_of_birth: getField("dateOfBirth") || null,
        gender: getField("gender") || null,
        blood_group: getField("bloodGroup") || null,
        address: getField("address") || null,
        emergency_contact_name: getField("emergencyName") || null,
        emergency_contact_mobile: getField("emergencyMobile") || null
    };

    // Validate date of birth.
    if (profileData.date_of_birth) {
        const dob = new Date(
            `${profileData.date_of_birth}T00:00:00`
        );

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (Number.isNaN(dob.getTime()) || dob > today) {
            showMessage(
                "Please enter a valid date of birth.",
                "danger"
            );
            return;
        }
    }

    const saveButton = document.getElementById("saveProfileButton");

    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = "Saving...";
    }

    try {
        const response = await fetch(`${API_URL}/api/patient/profile`, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(profileData)
        });

        const result = await response.json().catch(() => ({}));

        if (response.status === 401) {
            showMessage(
                "Your session is invalid or expired. Please log in again.",
                "danger"
            );
            return;
        }

        if (!response.ok) {
            const detail = result.detail;

            const errorMessage = Array.isArray(detail)
                ? detail.map(item => item.msg).join(", ")
                : detail ||
                  `Unable to save profile. HTTP ${response.status}`;

            throw new Error(errorMessage);
        }

        showMessage(
            result.message || "Patient profile saved successfully.",
            "success"
        );

        // Reload saved information from the backend.
        await loadPatientProfile();

    } catch (error) {
        console.error("Patient profile saving error:", error);

        showMessage(
            error.message || "Unable to save patient profile.",
            "danger"
        );

    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = "Save Profile";
        }
    }
}

/* =========================================================
   Field Helpers
   ========================================================= */

function getField(id) {
    const field = document.getElementById(id);
    return field ? field.value.trim() : "";
}

function setField(id, value) {
    const field = document.getElementById(id);

    if (field && value !== null && value !== undefined) {
        field.value = value;
    }
}
