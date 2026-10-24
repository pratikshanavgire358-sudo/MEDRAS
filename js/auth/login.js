
/* =========================================================
   MEDRA Login Handler
   ========================================================= */

"use strict";

// These accounts must exist in your local MEDRA database.
// Update these credentials to match the demo users you create.
const DEMO_CREDENTIALS = {
    patient: {
        email: "patient.demo@medra.test",
        password: "Patient@123"
    },
    hospital: {
        email: "hospital.demo@medra.test",
        password: "Hospital@123"
    },
    ambulance: {
        email: "driver.demo@medra.test",
        password: "Driver@123"
    },
    admin: {
        email: "admin.demo@medra.test",
        password: "Admin@123"
    }
};

function fillDemo(role) {
    const credentials = DEMO_CREDENTIALS[role];

    if (!credentials) {
        return;
    }

    const emailField = document.getElementById("email");
    const passwordField = document.getElementById("password");

    if (emailField) {
        emailField.value = credentials.email;
    }

    if (passwordField) {
        passwordField.value = credentials.password;
    }

    const messageBox = document.getElementById("loginMessage");

    if (messageBox) {
        messageBox.textContent =
            `Demo credentials filled for ${role}. Click Sign In to continue.`;
        messageBox.style.display = "block";
        messageBox.style.background = "#eaf4ff";
        messageBox.style.color = "#174a75";
        messageBox.style.border = "1px solid #b8d9f5";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const loginButton = document.getElementById("loginButton");
    const messageBox = document.getElementById("loginMessage");

    if (!loginForm) {
        return;
    }

    function showMessage(message, isSuccess = false) {
        if (!messageBox) {
            return;
        }

        messageBox.textContent = message;
        messageBox.style.display = "block";
        messageBox.style.padding = "12px 16px";
        messageBox.style.borderRadius = "8px";
        messageBox.style.background = isSuccess ? "#e8f7ee" : "#fff0f0";
        messageBox.style.color = isSuccess ? "#166534" : "#991b1b";
        messageBox.style.border = isSuccess
            ? "1px solid #86d3a2"
            : "1px solid #f0aaaa";
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = document.getElementById("email")?.value
            .trim()
            .toLowerCase();

        const password = document.getElementById("password")?.value;

        if (!email || !password) {
            showMessage("Enter your registered email and password.");
            return;
        }

        if (!window.MedraAPI ||
            typeof window.MedraAPI.post !== "function" ||
            typeof window.MedraAPI.setAuthSession !== "function") {
            showMessage("MEDRA API client is not loaded. Check js/api.js.");
            return;
        }

        if (loginButton) {
            loginButton.disabled = true;
            loginButton.textContent = "Verifying credentials...";
        }

        try {
            const result = await window.MedraAPI.post(
                "/api/auth/login",
                { email, password }
            );

            if (!result?.access_token || !result?.user?.role) {
                throw new Error("The backend returned an incomplete login response.");
            }

            const role = result.user.role.toLowerCase();

            if (!["patient", "ambulance", "hospital", "admin"].includes(role)) {
                throw new Error("Your account has an unsupported MEDRA role.");
            }

            if (
                role === "ambulance" &&
                !["EC_DRIVER", "EV_DOCTOR"].includes(
                    result.user.ambulance_subrole
                )
            ) {
                throw new Error(
                    "This ambulance account has no valid EC Driver or EV Doctor subrole."
                );
            }

            window.MedraAPI.setAuthSession(
                result.access_token,
                result.user
            );

            showMessage(
                `Login successful. Opening your ${role} portal...`,
                true
            );

            const dashboards = {
                patient: "../patient/dashboard.html",
                hospital: "../hospital/dashboard.html",
                admin: "../admin/dashboard.html"
            };

            const target = role === "ambulance"
                ? (
                    result.user.ambulance_subrole === "EV_DOCTOR"
                        ? "../ambulance/ev-doctor.html"
                        : "../ambulance/dashboard.html"
                )
                : dashboards[role];

            window.setTimeout(() => {
                window.location.href = target;
            }, 600);

        } catch (error) {
            console.error("MEDRA login error:", error);

            showMessage(
                error.message || "Login failed. Check your credentials and backend connection."
            );

            if (loginButton) {
                loginButton.disabled = false;
                loginButton.textContent = "Sign In to Dashboard →";
            }
        }
    });
});
