/* =========================================================
   MEDRA - Login Authentication
   Frontend: JavaScript
   Backend: FastAPI
   Database: PostgreSQL
   Authentication: JWT
   ========================================================= */

/* =========================================================
   Initialize Login
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    console.log("MEDRA authentication initialized.");

    const loginForm = document.getElementById("loginForm");

    if (!loginForm) {
        console.warn("No loginForm found on this page.");
        return;
    }

    loginForm.addEventListener("submit", handleLogin);
});

/* =========================================================
   Handle Login
   ========================================================= */

async function handleLogin(event) {
    event.preventDefault();

    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const loginButton = document.getElementById("loginButton");

    if (!emailInput || !passwordInput) {
        showLoginMessage("Email or password field is missing.", "danger");
        return;
    }

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    if (!email || !password) {
        showLoginMessage("Please enter your email and password.", "warning");
        return;
    }

    if (loginButton) {
        loginButton.disabled = true;
        loginButton.textContent = "Signing in...";
    }

    try {
        if (
            !window.MedraAPI ||
            typeof window.MedraAPI.post !== "function" ||
            typeof window.MedraAPI.setAuthSession !== "function"
        ) {
            throw new Error("MEDRA API client is unavailable. Check that js/api.js is loaded.");
        }

        const result = await window.MedraAPI.post(
            "/api/auth/login",
            { email, password }
        );

        if (!result.access_token || !result.user) {
            throw new Error("Login response is missing the token or user details.");
        }

        // Save the authenticated session
        window.MedraAPI.setAuthSession(result.access_token, result.user);
        sessionStorage.setItem("medraAuthenticated", "true");
        sessionStorage.setItem(
            "medraRole",
            String(result.user.role || "").toLowerCase()
        );

        console.log("MEDRA login successful.");
        console.log("Saved user:", result.user);
        console.log(
            "Token saved:",
            Boolean(sessionStorage.getItem("medra_access_token"))
        );

        showLoginMessage("Login successful! Opening dashboard...", "success");

        // Update this path if your dashboard is stored elsewhere.
        const role = String(result.user.role || "").toLowerCase();

        const dashboards = {
            patient: "../patient/dashboard.html",
            ambulance: "../ambulance/dashboard.html",
            hospital: "../hospital/dashboard.html",
            admin: "../admin/dashboard.html"
        };

        if (dashboards[role]) {
            setTimeout(() => {
                window.location.href = dashboards[role];
            }, 700);
        } else {
            showLoginMessage(
                "Login succeeded, but the dashboard for this role is not configured.",
                "warning"
            );
        }

    } catch (error) {
        console.error("Login error:", error);
        showLoginMessage(error.message, "danger");

    } finally {
        if (loginButton) {
            loginButton.disabled = false;
            loginButton.textContent = "Login";
        }
    }
}

/* =========================================================
   Display Login Messages
   ========================================================= */

function showLoginMessage(message, type = "danger") {
    const messageBox = document.getElementById("loginMessage");

    if (!messageBox) {
        console.log(message);
        return;
    }

    messageBox.textContent = message;
    messageBox.className = `alert alert-${type}`;
    messageBox.style.display = "block";
}

/* =========================================================
   Logout
   ========================================================= */

function clearMEDRASession() {
    sessionStorage.removeItem("medra_access_token");
    sessionStorage.removeItem("medra_user");
    sessionStorage.removeItem("medraAuthenticated");
    sessionStorage.removeItem("medraRole");
    sessionStorage.removeItem("medraLoginRole");

    console.log("MEDRA session cleared.");
}
