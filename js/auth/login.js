/* ==========================================
   MEDRA LOGIN
   FastAPI + PostgreSQL Authentication
========================================== */

const API_URL = "http://127.0.0.1:8000/api/auth/login";

document.addEventListener("DOMContentLoaded", () => {
    console.log("MEDRA login page loaded.");

    const loginForm = document.getElementById("loginForm");
    const loginButton = document.getElementById("loginButton");
    const messageBox = document.getElementById("loginMessage");

    if (!loginForm) {
        console.error(
            "Login form not found. Check the form ID in login.html."
        );
        return;
    }

    function showMessage(message, type = "danger") {
        if (!messageBox) {
            alert(message);
            return;
        }

        messageBox.textContent = message;
        messageBox.className = `alert alert-${type}`;
        messageBox.style.display = "block";
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email =
            document.getElementById("email")?.value.trim().toLowerCase();

        const password =
            document.getElementById("password")?.value;

        if (!email || !password) {
            showMessage("Please enter your email and password.");
            return;
        }

        if (loginButton) {
            loginButton.disabled = true;
            loginButton.textContent = "Signing in...";
        }

        try {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email: email,
                    password: password
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    typeof result.detail === "string"
                        ? result.detail
                        : "Login failed. Please check your credentials."
                );
            }

            // Store the authentication token and user information.
            sessionStorage.setItem(
                "medra_access_token",
                result.access_token
            );

            sessionStorage.setItem(
                "medra_user",
                JSON.stringify(result.user)
            );

            showMessage("Login successful!", "success");

            // Update these paths to match your actual dashboard filenames.
            const dashboards = {
                patient: "../user/patient-dashboard.html",
                family: "../user/family-dashboard.html",
                vehicle: "../user/vehicle-dashboard.html",
                ambulance: "../ambulance/ambulance-dashboard.html",
                hospital: "../hospital/hospital-dashboard.html",
                admin: "../admin/admin-dashboard.html"
            };

            const role = String(
                result.user?.role || ""
            ).toLowerCase();

            const dashboard = dashboards[role];

            if (!dashboard) {
                showMessage(
                    "Login succeeded, but no dashboard is configured for your account role.",
                    "warning"
                );
                return;
            }

            setTimeout(() => {
                window.location.href = dashboard;
            }, 700);

        } catch (error) {
            console.error("MEDRA login error:", error);

            showMessage(
                error.message ||
                "Unable to connect to the MEDRA server."
            );

        } finally {
            if (loginButton) {
                loginButton.disabled = false;
                loginButton.textContent = "Sign In";
            }
        }
    });
});