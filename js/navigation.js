/* =========================================================
   MEDRA Cross-Module Navigation Router
   ========================================================= */

"use strict";

function getProjectRoot() {
    const path = window.location.pathname.replace(/\\/g, "/");
    const pagesIndex = path.indexOf("/pages/");
    if (pagesIndex !== -1) {
        return path.substring(0, pagesIndex + 1); // includes trailing slash before pages
    }
    return "/";
}

function navigateTo(targetPath) {
    const root = getProjectRoot();
    window.location.href = `${root}${targetPath}`;
}

function getRoleDashboardUrl(role) {
    switch ((role || "").toLowerCase()) {
        case "patient":
            return "pages/patient/dashboard.html";
        case "hospital":
            return "pages/hospital/dashboard.html";
        case "ambulance":
            return "pages/ambulance/dashboard.html";
        case "admin":
            return "pages/admin/dashboard.html";
        default:
            return "pages/auth/login.html";
    }
}

function redirectToDashboard(role) {
    navigateTo(getRoleDashboardUrl(role));
}

// Global action handler for buttons
function go(action, role = "") {
    switch (action) {
        case "home":
            navigateTo("pages/index.html");
            break;
        case "register":
            navigateTo("pages/auth/signup.html");
            break;
        case "login":
            navigateTo("pages/auth/login.html");
            break;
        case "userselect":
        case "patient":
            navigateTo("pages/auth/patient-login.html");
            break;
        case "ambselect":
        case "ambulance":
            navigateTo("pages/auth/ambulance-login.html");
            break;
        case "hospselect":
        case "hospital":
            navigateTo("pages/auth/hospital-login.html");
            break;
        case "adminlogin":
        case "admin":
            navigateTo("pages/auth/admin-login.html");
            break;
        default:
            console.warn("Unknown navigation action:", action);
    }
}

function openPatientPage(page) {
    navigateTo(`pages/patient/${page}`);
}

function openHospitalPage(page) {
    navigateTo(`pages/hospital/${page}`);
}

function openAmbulancePage(page) {
    navigateTo(`pages/ambulance/${page}`);
}

function openAdminPage(page) {
    navigateTo(`pages/admin/${page}`);
}