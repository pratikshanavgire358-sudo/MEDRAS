/* =========================================================
   Page Navigation
   ========================================================= */

function goToSignup() {
    window.location.href = "auth/signup.html";
}

function goToLogin() {
    window.location.href = "auth/login.html";
}

/*
 * Navigate to the page associated with the selected role.
 * The paths below assume login.html is inside pages/auth/.
 */

function go(page, role) {

    const routes = {
        userselect: "user-login.html",
        ambselect: "ambulance-login.html",
        hospselect: "hospital-login.html",
        adminlogin: "admin-login.html",
        traffic: "traffic-login.html",
        register: "signup.html",
        loginotp: "login-otp.html"
    };

    const targetPage = routes[page];

    if (!targetPage) {
        console.error("Unknown MEDRA page:", page);
        alert("This page is not available yet.");
        return;
    }

    window.location.href = targetPage;
}