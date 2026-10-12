// ==========================================
// MedRA
// Signup OTP Verification
// ==========================================


// Demo OTP for browser prototype
const DEMO_SIGNUP_OTP = "123456";


// ==========================================
// PAGE LOAD
// ==========================================

document.addEventListener("DOMContentLoaded", function () {

    console.log("MedRA Signup OTP page loaded.");

    loadSignupInformation();

});


// ==========================================
// LOAD SIGNUP INFORMATION
// ==========================================

function loadSignupInformation() {

    const phoneDisplay =
        document.getElementById("phoneDisplay");

    const signupUserInfo =
        document.getElementById("signupUserInfo");


    // Get mobile number saved during signup
    const mobile =
        sessionStorage.getItem("medraSignupMobile");


    if (mobile && phoneDisplay) {

        phoneDisplay.textContent = mobile;

    }


    if (mobile && signupUserInfo) {

        signupUserInfo.textContent =
            "OTP verification is required to complete your account.";

    }

}


// ==========================================
// VERIFY REGISTRATION OTP
// ==========================================

function verifyRegistrationOtp() {

    console.log("Verify OTP button clicked.");


    const otpInput =
        document.getElementById("regotp");

    const message =
        document.getElementById("otperr");

    const verifyButton =
        document.getElementById("verifyOtpButton");


    // Make sure OTP field exists
    if (!otpInput) {

        console.error("OTP input field not found.");

        return;

    }


    const enteredOTP =
        otpInput.value.trim();


    console.log(
        "Entered OTP:",
        enteredOTP
    );


    // Clear previous message
    message.textContent = "";

    message.style.color =
        "var(--danger)";


    // ======================================
    // EMPTY OTP
    // ======================================

    if (enteredOTP === "") {

        message.textContent =
            "Please enter the OTP.";

        otpInput.focus();

        return;

    }


    // ======================================
    // OTP MUST HAVE 6 DIGITS
    // ======================================

    if (enteredOTP.length !== 6) {

        message.textContent =
            "Please enter all 6 digits of the OTP.";

        otpInput.focus();

        return;

    }


    // ======================================
    // DEMO OTP VERIFICATION
    // ======================================

    if (enteredOTP === DEMO_SIGNUP_OTP) {

        console.log(
            "OTP verified successfully."
        );


        // Save verification status
        sessionStorage.setItem(
            "medraSignupVerified",
            "true"
        );


        // Get selected role
        const role =
            sessionStorage.getItem(
                "medraSignupRole"
            );


        if (role) {

            sessionStorage.setItem(
                "medraRole",
                role
            );

        }


        // Success message
        message.style.color =
            "var(--green)";

        message.textContent =
            "OTP verified successfully! Redirecting to Login...";


        // Disable button
        if (verifyButton) {

            verifyButton.disabled = true;

            verifyButton.textContent =
                "Verified ✓";

        }


        // Redirect to login
        setTimeout(function () {

            window.location.href =
                "login.html";

        }, 1000);


        return;

    }


    // ======================================
    // INVALID OTP
    // ======================================

    message.textContent =
        "Invalid OTP. Please use 123456.";

    otpInput.focus();

}


// ==========================================
// RESEND OTP
// ==========================================

function resendRegisterOtp() {

    const message =
        document.getElementById("otperr");


    message.style.color =
        "var(--green)";


    message.textContent =
        "Demo OTP sent successfully: 123456";


    console.log(
        "Demo OTP:",
        DEMO_SIGNUP_OTP
    );

}