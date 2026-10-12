/* ==========================================
   MEDRA
   SIGNUP / REGISTRATION JAVASCRIPT
   FastAPI + PostgreSQL Integration
========================================== */

const API_URL = "http://127.0.0.1:8000/api/auth/register";

/* ==========================================
   INITIALIZATION
========================================== */

document.addEventListener("DOMContentLoaded", function () {
    console.log("MEDRA Signup page loaded.");

    setupSignupValidation();

    const signupForm = document.getElementById("signupForm");

    if (signupForm) {
        signupForm.addEventListener("submit", validateRegistration);
    }
});

/* ==========================================
   INPUT VALIDATION SETUP
========================================== */

function setupSignupValidation() {
    const mobile = document.getElementById("mobile");
    const password = document.getElementById("password");
    const confirmPassword = document.getElementById("confirmPassword");

    // Allow only digits in the mobile field.
    if (mobile) {
        mobile.addEventListener("input", function () {
            this.value = this.value.replace(/[^0-9]/g, "");
        });
    }

    // Check whether passwords match.
    if (confirmPassword && password) {
        confirmPassword.addEventListener("input", checkPasswordMatch);
        password.addEventListener("input", checkPasswordMatch);
    }

    function checkPasswordMatch() {
        if (!confirmPassword.value) {
            confirmPassword.style.borderColor = "";
            return;
        }

        confirmPassword.style.borderColor =
            confirmPassword.value === password.value
                ? "#06b878"
                : "#ef4554";
    }
}

/* ==========================================
   MAIN REGISTRATION FUNCTION
========================================== */

async function validateRegistration(event) {
    if (event) {
        event.preventDefault();
    }

    const fullName =
        document.getElementById("fullName").value.trim();

    const email =
        document.getElementById("email").value.trim().toLowerCase();

    const mobile =
        document.getElementById("mobile").value.trim();

    const role =
        document.getElementById("role").value;

    const password =
        document.getElementById("password").value;

    const confirmPassword =
        document.getElementById("confirmPassword").value;

    const terms =
        document.getElementById("terms").checked;

    const button =
        document.getElementById("signupButton");

    hideSignupError();
    hideSignupSuccess();

    /* ==========================================
       VALIDATE FULL NAME
    ========================================== */

    if (fullName.length < 3) {
        showSignupError(
            "Full name must contain at least 3 characters."
        );

        focusField("fullName");
        return;
    }

    /* ==========================================
       VALIDATE EMAIL
    ========================================== */

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
        showSignupError("Please enter a valid email address.");
        focusField("email");
        return;
    }

    /* ==========================================
       VALIDATE MOBILE NUMBER
    ========================================== */

    const mobilePattern = /^[6-9][0-9]{9}$/;

    if (!mobilePattern.test(mobile)) {
        showSignupError(
            "Please enter a valid 10-digit Indian mobile number."
        );

        focusField("mobile");
        return;
    }

    /* ==========================================
       VALIDATE ACCOUNT TYPE
    ========================================== */

    const allowedRoles = ["patient", "family", "vehicle"];

    if (!allowedRoles.includes(role)) {
        showSignupError("Please select an account type.");
        focusField("role");
        return;
    }

    /* ==========================================
       VALIDATE PASSWORD
    ========================================== */

    if (password.length < 8) {
        showSignupError(
            "Password must contain at least 8 characters."
        );

        focusField("password");
        return;
    }

    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        showSignupError(
            "Password must contain at least one letter and one number."
        );

        focusField("password");
        return;
    }

    /* ==========================================
       CONFIRM PASSWORD
    ========================================== */

    if (password !== confirmPassword) {
        showSignupError(
            "Password and confirm password do not match."
        );

        focusField("confirmPassword");
        return;
    }

    /* ==========================================
       TERMS AND CONDITIONS
    ========================================== */

    if (!terms) {
        showSignupError(
            "Please accept the Terms & Conditions and Privacy Policy."
        );

        return;
    }

    /* ==========================================
       SEND DATA TO FASTAPI
    ========================================== */

    button.disabled = true;
    button.textContent = "Creating Account...";

    try {
        const response = await fetch(API_URL, {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                full_name: fullName,
                email: email,
                mobile: mobile,
                password: password
            })
        });

        const result = await response.json();

        if (!response.ok) {
            let errorMessage = "Registration failed.";

            if (typeof result.detail === "string") {
                errorMessage = result.detail;
            } else if (Array.isArray(result.detail)) {
                errorMessage = result.detail
                    .map(item => item.msg)
                    .join(" ");
            }

            throw new Error(errorMessage);
        }

        /* ==========================================
           REGISTRATION SUCCESS
        ========================================== */

        // Store only non-sensitive details in the browser.
        sessionStorage.setItem("medraSignupName", fullName);
        sessionStorage.setItem("medraSignupEmail", email);
        sessionStorage.setItem("medraSignupMobile", mobile);
        sessionStorage.setItem("medraSignupRole", role);

        showSignupSuccess(
            "Account created successfully! Your details have been saved."
        );

        button.textContent = "Account Created";

        /* ==========================================
           REDIRECT TO LOGIN
        ========================================== */

        setTimeout(function () {
            window.location.href = "login.html";
        }, 1500);

    } catch (error) {
        console.error("MEDRA signup error:", error);

        let message = error.message;

        if (error instanceof TypeError) {
            message =
                "Unable to connect to MEDRA. Check your backend and frontend connection.";
        }

        showSignupError(message);

        button.disabled = false;
        button.textContent = "Create Account";
    }
}

/* ==========================================
   PASSWORD STRENGTH
========================================== */

function checkPasswordStrength(password) {
    const hasLetter = /[A-Za-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    return hasLetter && hasNumber;
}

/* ==========================================
   SHOW ERROR MESSAGE
========================================== */

function showSignupError(message) {
    const errorBox = document.getElementById("signupError");

    if (!errorBox) {
        alert(message);
        return;
    }

    errorBox.textContent = message;
    errorBox.style.display = "block";

    errorBox.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

/* ==========================================
   HIDE ERROR MESSAGE
========================================== */

function hideSignupError() {
    const errorBox = document.getElementById("signupError");

    if (errorBox) {
        errorBox.textContent = "";
        errorBox.style.display = "none";
    }
}

/* ==========================================
   SHOW SUCCESS MESSAGE
========================================== */

function showSignupSuccess(message) {
    const successBox = document.getElementById("signupSuccess");

    if (successBox) {
        successBox.textContent = message;
        successBox.style.display = "block";

        successBox.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }
}

/* ==========================================
   HIDE SUCCESS MESSAGE
========================================== */

function hideSignupSuccess() {
    const successBox = document.getElementById("signupSuccess");

    if (successBox) {
        successBox.textContent = "";
        successBox.style.display = "none";
    }
}

/* ==========================================
   FOCUS FIELD
========================================== */

function focusField(id) {
    const field = document.getElementById(id);

    if (field) {
        setTimeout(function () {
            field.focus();
        }, 100);
    }
}