/* =========================================================
   MEDRA - Login Authentication
   Frontend: JavaScript
   Backend: FastAPI
   Database: PostgreSQL
   Authentication: JWT
   ========================================================= */

const MEDRA_API_URL = "http://127.0.0.1:8000/api/auth/login";

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
        const response = await fetch(
            "http://127.0.0.1:8000/api/auth/login",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    email: email,
                    password: password
                })
            }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.detail || "Login failed. Please check your credentials."
            );
        }

        if (!result.access_token || !result.user) {
            throw new Error("Login response is missing the token or user details.");
        }

        // Save the authenticated session
        sessionStorage.setItem("medra_access_token", result.access_token);
        sessionStorage.setItem("medra_user", JSON.stringify(result.user));
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

    try {
        showLoginMessage("Connecting to MEDRA...", "info");

        const response = await fetch(MEDRA_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                email: email,
                password: password
            })
        });

        // Safely read the response.
        const result = await response.json().catch(() => ({}));

        // Handle authentication errors.
        if (!response.ok) {
            let errorMessage = "Login failed. Please try again.";

            if (typeof result.detail === "string") {
                errorMessage = result.detail;
            } else if (Array.isArray(result.detail)) {
                errorMessage = result.detail
                    .map(item => item.msg)
                    .join(", ");
            }

            throw new Error(errorMessage);
        }

        // Validate the backend response.
        if (
            typeof result.access_token !== "string" ||
            !result.access_token ||
            !result.user
        ) {
            throw new Error(
                "The backend did not return a valid login token and user."
            );
        }

        // Save the login session in the current tab.
        sessionStorage.setItem(
            "medra_access_token",
            result.access_token
        );

        sessionStorage.setItem(
            "medra_user",
            JSON.stringify(result.user)
        );

        sessionStorage.setItem(
            "medraAuthenticated",
            "true"
        );

        const role = String(
            result.user.role || ""
        ).toLowerCase();

        sessionStorage.setItem("medraRole", role);

        // Verify that the token was stored.
        const savedToken = sessionStorage.getItem(
            "medra_access_token"
        );

        if (savedToken !== result.access_token) {
            throw new Error(
                "The login token could not be saved in browser storage."
            );
        }

        console.log("MEDRA login successful.");
        console.log("Token saved:", Boolean(savedToken));
        console.log("User role:", role);

        showLoginMessage(
            "Login successful! Welcome to MEDRA.",
            "success"
        );

        if (loginButton) {
            loginButton.textContent = "Login Successful";
        }

        /*
         * Dashboard navigation is intentionally not hard-coded here.
         * Add the actual dashboard path after confirming your
         * project's folder structure.
         */

    } catch (error) {
        console.error("MEDRA login error:", error);

        let message = error.message;

        if (error instanceof TypeError) {
            message =
                "Cannot connect to MEDRA. Check that FastAPI is running " +
                "and that the frontend can reach the backend.";
        }

        showLoginMessage(message, "danger");

    } finally {
        if (loginButton) {
            loginButton.disabled = false;

            if (
                loginButton.textContent !== "Login Successful"
            ) {
                loginButton.textContent = "Sign In";
            }
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
