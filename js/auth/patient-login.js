const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginButton = document.getElementById("loginButton");

const API_URL = "http://127.0.0.1:8000/api/auth/login";

// Show error message
function showError(message) {
    loginError.textContent = message;
    loginError.hidden = false;
}

// Hide error message
function hideError() {
    loginError.textContent = "";
    loginError.hidden = true;
}

// Handle login form submission
loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    hideError();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";

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

        const data = await response.json();

        // Handle incorrect credentials and other server errors
        if (!response.ok) {
            showError(data.detail || "Login failed. Please try again.");
            return;
        }

        // Verify the response
        if (!data.access_token || !data.user) {
            showError("Invalid response from the server.");
            return;
        }

        // Ensure this is a patient account
        if (data.user.role !== "patient") {
            showError("This account is not registered as a patient.");
            return;
        }

        // Store the login session
        sessionStorage.setItem("medraAccessToken", data.access_token);
        sessionStorage.setItem(
            "medraUser",
            JSON.stringify(data.user)
        );

        // Redirect after successful login
window.location.href = "../patient/dashboard.html";
    } catch (error) {
        console.error("Login error:", error);

        showError(
            "Unable to connect to the MEDRA server. Please try again."
        );
    } finally {
        loginButton.disabled = false;
        loginButton.textContent = "Login to MEDRA →";
    }
});