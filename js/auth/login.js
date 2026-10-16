/* =========================================================
   MEDRA Login Handler
   ========================================================= */

"use strict";

const DEMO_CREDENTIALS = {
    patient: { email: "patient@medra.org", password: "Password@123" },
    hospital: { email: "hospital@medra.org", password: "Password@123" },
    ambulance: { email: "ambulance@medra.org", password: "Password@123" },
    admin: { email: "admin@medra.org", password: "Password@123" }
};

function fillDemo(role) {
    const creds = DEMO_CREDENTIALS[role];
    if (!creds) return;
    const emailField = document.getElementById("email");
    const passField = document.getElementById("password");
    if (emailField) emailField.value = creds.email;
    if (passField) passField.value = creds.password;
    if (typeof showNotification === "function") {
        showNotification(`Filled demo credentials for ${role.toUpperCase()}`, "info");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const loginButton = document.getElementById("loginButton");
    const messageBox = document.getElementById("loginMessage");

    function showMessage(msg, isSuccess = false) {
        if (!messageBox) return;
        messageBox.textContent = msg;
        messageBox.style.display = "block";
        messageBox.style.background = isSuccess ? "rgba(6, 184, 120, 0.12)" : "rgba(239, 69, 84, 0.12)";
        messageBox.style.color = isSuccess ? "#047857" : "#b91c1c";
        messageBox.style.border = `1px solid ${isSuccess ? "#06b878" : "#ef4554"}`;
    }

    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const emailInput = document.getElementById("email");
            const passInput = document.getElementById("password");

            const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
            const password = passInput ? passInput.value : "";

            if (!email || !password) {
                showMessage("Please enter your registered email and password.");
                return;
            }

            if (loginButton) {
                loginButton.disabled = true;
                loginButton.textContent = "Verifying Credentials...";
            }

            try {
                const result = await window.MedraAPI.post("/api/auth/login", {
                    email,
                    password
                });

                window.MedraAPI.setAuthSession(result.access_token, result.user);
                showMessage(`Welcome back, ${result.user.full_name}! Redirecting to ${result.user.role} portal...`, true);

                setTimeout(() => {
                    const dashboards = {
                        patient: "../patient/dashboard.html",
                        hospital: "../hospital/dashboard.html",
                        ambulance: "../ambulance/dashboard.html",
                        admin: "../admin/dashboard.html"
                    };

                    const target = dashboards[result.user.role.toLowerCase()] || "../patient/dashboard.html";
                    window.location.href = target;
                }, 800);

            } catch (err) {
                console.error("Login failure:", err);
                showMessage(err.message || "Login failed. Check your email and password.");
                if (loginButton) {
                    loginButton.disabled = false;
                    loginButton.textContent = "Sign In to Dashboard →";
                }
            }
        });
    }
});