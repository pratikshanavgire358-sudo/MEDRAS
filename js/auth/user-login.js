/* =====================================================
   MEDRA USER LOGIN - FIREBASE
   ===================================================== */

import {
    signInWithEmailAndPassword,
    signInWithPopup,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

import { auth ,googleProvider } from "../firebase.js";


const form = document.getElementById("userLoginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const loginButton = document.getElementById("loginButton");
const loginButtonText = document.getElementById("loginButtonText");

const googleButton = document.getElementById("googleLoginButton");
const togglePasswordButton = document.getElementById("togglePassword");
const forgotPasswordButton = document.getElementById("forgotPasswordButton");

const message = document.getElementById("loginMessage");


/* Show messages */

function showMessage(text, type = "error") {

    message.textContent = text;
    message.className = `login-message ${type}`;

}


/* Show/hide password */

togglePasswordButton.addEventListener("click", function () {

    const isPassword =
        passwordInput.type === "password";

    passwordInput.type =
        isPassword ? "text" : "password";

    togglePasswordButton.textContent =
        isPassword ? "Hide" : "Show";

    togglePasswordButton.setAttribute(
        "aria-label",
        isPassword ? "Hide password" : "Show password"
    );

});


/* Enable/disable login button */

function setLoading(isLoading) {

    loginButton.disabled = isLoading;
    googleButton.disabled = isLoading;

    loginButtonText.textContent =
        isLoading ? "Signing in..." : "Sign in";

}


/*
 * Exchange Firebase's verified identity for the MEDRA JWT used by protected APIs.
 */

async function verifyBackendAccess(user) {
    const api = window.MedraAPI;

    if (
        !api ||
        typeof api.post !== "function" ||
        typeof api.setAuthSession !== "function"
    ) {
        throw new Error("MEDRA API client is unavailable. Please reload and try again.");
    }

    const firebaseIdToken = await user.getIdToken();
    const result = await api.post("/api/auth/firebase", {
        firebase_id_token: firebaseIdToken
    });

    if (!result?.access_token || !result?.user) {
        throw new Error("MEDRA returned an incomplete login response.");
    }

    return result;
}


/* Authenticate and open authorized dashboard */

async function completeLogin(user) {

    showMessage("Verifying your MEDRA account...", "success");

    const result = await verifyBackendAccess(user);
    const profile = result.user;

    /*
     * Backend must return an authorized profile.
     * Do not trust a role supplied by the browser.
     */

    const role = profile.role;

    if (role !== "patient" && role !== "admin") {

        throw new Error(
            "This account is not authorized for the patient dashboard."
        );

    }

    window.MedraAPI.setAuthSession(result.access_token, profile);
    sessionStorage.setItem("medraAuthenticated", "true");
    sessionStorage.setItem("medraRole", role);

    window.location.href = "../patient/dashboard.html";

}


/* Email/password login */

form.addEventListener("submit", async function (event) {

    event.preventDefault();

    showMessage("");

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {

        showMessage("Enter your email address and password.");
        return;

    }

    setLoading(true);

    try {

        const result = await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

        await completeLogin(result.user);

    } catch (error) {

        console.error("MEDRA login error:", error);

        const messages = {
            "auth/invalid-credential":
                "Incorrect email or password.",

            "auth/user-not-found":
                "No account was found with this email.",

            "auth/wrong-password":
                "Incorrect email or password.",

            "auth/invalid-email":
                "Enter a valid email address.",

            "auth/too-many-requests":
                "Too many attempts. Please try again later.",

            "auth/network-request-failed":
                "Network error. Check your internet connection."
        };

        showMessage(
            messages[error.code] ||
            error.message ||
            "Login failed. Please try again."
        );

    } finally {

        setLoading(false);

    }

});


/* Google sign-in */

/* Google sign-in */

googleButton.addEventListener("click", async function () {

    showMessage("");
    setLoading(true);

    try {

        const result = await signInWithPopup(auth, googleProvider);
await completeLogin(result.user);
    } catch (error) {

        console.error("Firebase error code:", error.code);
        console.error("Firebase error message:", error.message);

        const messages = {
            "auth/unauthorized-domain":
                "This website domain is not authorized in Firebase.",

            "auth/operation-not-allowed":
                "Google sign-in is not enabled in Firebase Authentication.",

            "auth/popup-blocked":
                "Your browser blocked the Google sign-in popup.",

            "auth/popup-closed-by-user":
                "The Google sign-in window was closed.",

            "auth/invalid-credential":
                "Google authentication failed. Please try again.",

            "auth/network-request-failed":
                "Network error. Check your internet connection.",

            "auth/account-exists-with-different-credential":
                "This email is associated with another sign-in method."
        };

        showMessage(
            messages[error.code] ||
            `Google sign-in failed: ${error.code || error.message}`
        );

    } finally {

        setLoading(false);

    }

});


/* Forgot password */

forgotPasswordButton.addEventListener("click", async function () {

    const email = emailInput.value.trim();

    if (!email) {

        showMessage(
            "Enter your email address first to reset your password."
        );

        emailInput.focus();

        return;

    }

    try {

        await sendPasswordResetEmail(auth, email);

        showMessage(
            "If an account exists for this email, password-reset instructions will be sent.",
            "success"
        );

    } catch (error) {

        console.error("Password reset error:", error);

        if (
            error.code === "auth/invalid-email"
        ) {

            showMessage("Enter a valid email address.");

        } else {

            showMessage(
                "Unable to start password reset. Please try again."
            );

        }

    }

});