"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("signupForm");
    const nameInput = document.getElementById("fullName");
    const emailInput = document.getElementById("email");
    const mobileInput = document.getElementById("mobile");
    const roleInput = document.getElementById("role");
    const passwordInput = document.getElementById("password");
    const confirmInput = document.getElementById("confirmPassword");
    const termsInput = document.getElementById("terms");
    const submitButton = document.getElementById("signupButton");

    if (!form || !nameInput || !emailInput || !roleInput || !passwordInput || !confirmInput || !submitButton) {
        console.error("MEDRA signup: Required form elements are missing.");
        return;
    }

    const allowedRoles = ["patient", "hospital", "ambulance"];

    // Digits only for mobile
    if (mobileInput) {
        mobileInput.addEventListener("input", () => {
            mobileInput.value = mobileInput.value.replace(/\D/g, "").slice(0, 10);
        });
    }

    form.addEventListener("input", hideMessages);
    form.addEventListener("change", hideMessages);

    function validatePasswordMatch() {
        if (!confirmInput.value) {
            confirmInput.setCustomValidity("");
            return;
        }
        if (passwordInput.value !== confirmInput.value) {
            confirmInput.setCustomValidity("Passwords do not match.");
        } else {
            confirmInput.setCustomValidity("");
        }
    }

    confirmInput.addEventListener("input", validatePasswordMatch);
    passwordInput.addEventListener("input", validatePasswordMatch);

    function showError(message) {
        const box = document.getElementById("signupError");
        if (!box) {
            alert(message);
            return;
        }
        box.textContent = message;
        box.style.display = "block";
    }

    function showSuccess(message) {
        const box = document.getElementById("signupSuccess");
        if (box) {
            box.textContent = message;
            box.style.display = "block";
        }
    }

    function hideMessages() {
        const errorBox = document.getElementById("signupError");
        const successBox = document.getElementById("signupSuccess");
        if (errorBox) {
            errorBox.textContent = "";
            errorBox.style.display = "none";
        }
        if (successBox) {
            successBox.textContent = "";
            successBox.style.display = "none";
        }
    }

    function validateForm() {
        const fullName = nameInput.value.trim();
        const email = emailInput.value.trim();
        const mobile = mobileInput ? mobileInput.value.trim() : null;
        const role = roleInput.value;
        const password = passwordInput.value;
        const confirmPassword = confirmInput.value;

        if (fullName.length < 2) {
            return { valid: false, field: nameInput, message: "Enter your full name (at least 2 characters)." };
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            return { valid: false, field: emailInput, message: "Enter a valid email address." };
        }

        if (mobile && mobile.length > 0 && !/^[6-9]\d{9}$/.test(mobile)) {
            return { valid: false, field: mobileInput, message: "Enter a valid 10-digit Indian mobile number." };
        }

        if (!allowedRoles.includes(role)) {
            return { valid: false, field: roleInput, message: "Select a valid account type." };
        }

        if (password.length < 8) {
            return { valid: false, field: passwordInput, message: "Password must be at least 8 characters long." };
        }

        if (password !== confirmPassword) {
            return { valid: false, field: confirmInput, message: "Passwords do not match." };
        }

        if (termsInput && !termsInput.checked) {
            return { valid: false, field: termsInput, message: "Please accept the Terms & Conditions and Privacy Policy." };
        }

        return {
            valid: true,
            data: {
                full_name: fullName,
                email: email.toLowerCase(),
                mobile: mobile || null,
                role: role,
                password: password
            }
        };
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideMessages();

        const validation = validateForm();
        if (!validation.valid) {
            showError(validation.message);
            if (validation.field) validation.field.focus();
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = "Creating Account in PostgreSQL...";

        try {
            const api = window.MedraAPI;
            const result = await api.post("/api/auth/register", validation.data);

            showSuccess("Account registered successfully! Redirecting to login...");
            submitButton.textContent = "Account Created";

            setTimeout(() => {
                window.location.href = "login.html";
            }, 1200);

        } catch (error) {
            console.error("MEDRA registration error:", error);
            showError(error.message || "Registration failed. Please check inputs or database connectivity.");
            submitButton.disabled = false;
            submitButton.textContent = "Create Account";
        }
    });
});