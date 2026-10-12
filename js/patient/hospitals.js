// ============================================
// MEDRA PATIENT DASHBOARD - USER INFORMATION
// ============================================

document.addEventListener("DOMContentLoaded", async () => {
    const sidebarUserName = document.getElementById("sidebarUserName");
    const sidebarAvatar = document.getElementById("sidebarAvatar");

    const topUserName = document.getElementById("topUserName");
    const topAvatar = document.getElementById("topAvatar");

    const welcomeName = document.getElementById("welcomeName");

    const API_URL = "http://127.0.0.1:8000";

    // Read the token saved after successful login
    const token =
        localStorage.getItem("access_token") ||
        sessionStorage.getItem("access_token");

    // Display the registered name in all dashboard locations
    function displayPatientName(name) {
        const patientName =
            typeof name === "string" && name.trim()
                ? name.trim()
                : "Patient";

        const initials = patientName
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part.charAt(0).toUpperCase())
            .join("");

        if (sidebarUserName) {
            sidebarUserName.textContent = patientName;
        }

        if (topUserName) {
            topUserName.textContent = patientName;
        }

        if (welcomeName) {
            welcomeName.textContent = patientName;
        }

        if (sidebarAvatar) {
            sidebarAvatar.textContent = initials || "P";
        }

        if (topAvatar) {
            topAvatar.textContent = initials || "P";
        }
    }

    // Do not trust a name stored in the browser as the source of truth.
    // Fetch the authenticated patient's profile from FastAPI.
    async function loadPatientProfile() {
        if (!token) {
            displayPatientName("Patient");
            console.warn("No login token found. Please log in again.");
            return;
        }

        try {
            const response = await fetch(
                `${API_URL}/api/patient/profile`,
                {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Accept": "application/json"
                    }
                }
            );

            if (response.status === 401 || response.status === 403) {
                displayPatientName("Patient");
                console.warn("Your session is invalid or expired.");
                return;
            }

            if (!response.ok) {
                throw new Error(
                    `Profile request failed: ${response.status}`
                );
            }

            const profile = await response.json();

            // Adjust these field names to match your actual API response.
            const registeredName =
                profile.full_name ||
                profile.name ||
                profile.username ||
                profile.patient_name;

            if (registeredName) {
                displayPatientName(registeredName);
            } else {
                console.warn(
                    "The profile response does not contain a name field.",
                    profile
                );
                displayPatientName("Patient");
            }

        } catch (error) {
            console.error("Unable to load patient profile:", error);
            displayPatientName("Patient");
        }
    }

    await loadPatientProfile();
});