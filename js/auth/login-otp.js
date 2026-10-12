// ==========================================
// MEDRA - LOGIN OTP
// ==========================================

document.addEventListener("DOMContentLoaded", function () {

    loadLoginInformation();

    const form = document.getElementById("loginOtpForm");

    if (form) {
        form.addEventListener("submit", verifyLoginOtp);
    }

});


// ==========================================
// LOAD LOGIN INFORMATION
// ==========================================

function loadLoginInformation() {

    const role =
        sessionStorage.getItem("medraLoginRole") || "User";

    const identifier =
        sessionStorage.getItem("medraLoginIdentifier") ||
        "Registered account";

    const roleElement =
        document.getElementById("loginRole");

    const identifierElement =
        document.getElementById("loginIdentifier");

    if (roleElement) {
        roleElement.textContent = role;
    }

    if (identifierElement) {
        identifierElement.textContent = identifier;
    }

}


// ==========================================
// VERIFY OTP
// ==========================================

function verifyLoginOtp(event) {

    event.preventDefault();

    const otpInput =
        document.getElementById("otp");

    const error =
        document.getElementById("otpError");

    const success =
        document.getElementById("otpSuccess");

    const otp =
        otpInput.value.trim();


    error.textContent = "";
    success.textContent = "";


    // Validate OTP
    if (!/^\d{6}$/.test(otp)) {

        error.textContent =
            "Please enter a valid 6-digit OTP.";

        return;
    }


    /*
        FRONTEND DEMO ONLY

        The original MEDRA prototype uses:
        123456

        In the real system this must be
        generated and verified by FastAPI.
    */

    const demoOtp = "123456";


    if (otp !== demoOtp) {

        error.textContent =
            "Invalid OTP. Please try again.";

        return;
    }


    // OTP verified
    success.textContent =
        "OTP verified successfully.";


    // Create demo session
    sessionStorage.setItem(
        "medraAuthenticated",
        "true"
    );


    const role =
        sessionStorage.getItem("medraLoginRole") ||
        "User";


    sessionStorage.setItem(
        "medraRole",
        role
    );


    // Redirect according to role
    setTimeout(function () {

        redirectAfterLogin(role);

    }, 700);

}


// ==========================================
// REDIRECT AFTER LOGIN
// ==========================================

function redirectAfterLogin(role) {

    const normalizedRole =
        role.toLowerCase();


    if (
        normalizedRole.includes("admin")
    ) {

        window.location.href =
            "../admin/dashboard.html";

        return;
    }


    if (
        normalizedRole.includes("ambulance")
    ) {

        window.location.href =
            "../ambulance/dashboard.html";

        return;
    }


    if (
        normalizedRole.includes("hospital")
    ) {

        window.location.href =
            "../hospital/dashboard.html";

        return;
    }


    // Default = Patient/User
    window.location.href =
        "../patient/dashboard.html";
}


// ==========================================
// RESEND OTP
// ==========================================

function resendLoginOtp() {

    const error =
        document.getElementById("otpError");

    const success =
        document.getElementById("otpSuccess");

    error.textContent = "";

    success.textContent =
        "A new OTP has been sent.";


    startResendTimer();

}


// ==========================================
// RESEND TIMER
// ==========================================

function startResendTimer() {

    const button =
        document.getElementById("resendOtpBtn");

    const timerText =
        document.getElementById("timerText");


    let seconds = 30;

    button.disabled = true;


    const timer =
        setInterval(function () {

            timerText.textContent =
                `You can resend OTP in ${seconds}s`;

            seconds--;


            if (seconds < 0) {

                clearInterval(timer);

                button.disabled = false;

                timerText.textContent =
                    "Didn't receive the OTP?";

            }

        }, 1000);

}


// ==========================================
// BACK
// ==========================================

function goBack() {

    window.location.href =
        "login.html";

}