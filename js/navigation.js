/* =========================================================
   MEDRA - Navigation
   ========================================================= */

/*
  Update these paths to match your actual project structure.

  These paths assume navigation.js is loaded by:
  frontend/pages/auth/login.html

  The destinations are examples until we confirm your
  actual filenames.
*/

const MEDRA_ROUTES = {
    home: "../../index.html",
    register: "./register.html",

    userselect: "../user/login.html",
    ambselect: "../ambulance/login.html",
    hospselect: "../hospital/login.html",

    adminlogin: "../admin/login.html",
    traffic: "../traffic/login.html"
};


/* =========================================================
   General Navigation
   ========================================================= */

function go(page, role = "") {

    const destination = MEDRA_ROUTES[page];

    if (!destination) {
        console.error("MEDRA route not configured:", page);
        alert("This MEDRA page has not been configured yet.");
        return;
    }

    if (role) {
        sessionStorage.setItem("medraLoginRole", role);
    }

    window.location.href = destination;
}


/* =========================================================
   Patient Page Navigation
   ========================================================= */

function openPatientPage(page) {

    const allowedPages = [
        "dashboard.html",
        "emergency.html",
        "ambulance.html",
        "hospitals.html",
        "vitals.html",
        "medical-history.html",
        "family.html",
        "notifications.html",
        "profile.html",
        "settings.html"
    ];

    if (!allowedPages.includes(page)) {
        console.error("Invalid patient page:", page);
        return;
    }

    window.location.href = "../patient/" + page;
}


/* =========================================================
   How It Works
   ========================================================= */

function showHowItWorks() {

    const section = document.getElementById("howItWorks");

    if (section) {
        section.scrollIntoView({
            behavior: "smooth"
        });
    }
}


/* =========================================================
   Logout
   ========================================================= */

function logoutMedra() {

    localStorage.removeItem("medraUser");
    localStorage.removeItem("medraRole");

    sessionStorage.removeItem("medraAuthenticated");
    sessionStorage.removeItem("medraRole");
    sessionStorage.removeItem("medraLoginRole");
    sessionStorage.removeItem("medraLoginIdentifier");

    sessionStorage.removeItem("medra_access_token");
    sessionStorage.removeItem("medra_user");

    window.location.href = "../../index.html";
}


/* =========================================================
   Patient Sidebar Navigation
   ========================================================= */

document.addEventListener("DOMContentLoaded", function () {

    const patientLinks = document.querySelectorAll(
        ".patient-page .sidebar-nav a"
    );

    patientLinks.forEach(function (link) {

        const href = link.getAttribute("href");

        if (!href || href === "#") {
            return;
        }

        if (
            href.startsWith("http://") ||
            href.startsWith("https://")
        ) {
            return;
        }

        link.addEventListener("click", function (event) {

            if (href.startsWith("./")) {
                event.preventDefault();
                window.location.href = href;
            }

        });

    });

});