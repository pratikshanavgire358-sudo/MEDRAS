"use strict";

function fillPatientDemo() {
    const email = document.getElementById("email");
    const pass = document.getElementById("password");
    if (email) email.value = "patient@medra.org";
    if (pass) pass.value = "Password@123";
    if (typeof showNotification === "function") {
        showNotification("Filled demo patient credentials", "info");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const loginError = document.getElementById("loginError");
    const loginButton = document.getElementById("loginButton");

    function showError(message) {
        if (!loginError) return;
        loginError.textContent = message;
        loginError.hidden = false;
    }

    function hideError() {
        if (!loginError) return;
        loginError.textContent = "";
        loginError.hidden = true;
    }

    if (loginForm) {
        loginForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            hideError();

            const email = document.getElementById("email").value.trim().toLowerCase();
            const password = document.getElementById("password").value;

            loginButton.disabled = true;
            loginButton.textContent = "Verifying patient credentials...";

            try {
                const api = window.MedraAPI;
                const data = await api.post("/api/auth/login", { email, password });

                if (data.user.role !== "patient" && data.user.role !== "admin") {
                    showError("This account is not registered as a patient. Please use the appropriate portal.");
                    loginButton.disabled = false;
                    loginButton.textContent = "Sign In to Patient Portal →";
                    return;
                }

                api.setAuthSession(data.access_token, data.user);
                window.location.href = "../patient/dashboard.html";

            } catch (error) {
                console.error("Login error:", error);
                showError(error.message || "Unable to log in. Please check credentials or database status.");
                loginButton.disabled = false;
                loginButton.textContent = "Sign In to Patient Portal →";
            }
        });
    }
});