/* =========================================================
   MEDRA Application Renderer
   ========================================================= */

function render() {
    if (
        new URLSearchParams(location.search).get("admin") === "1" &&
        state.page === "home"
    ) {
        state.page = "adminlogin";
    }

    if (localStorage.medTheme === "dark") {
        document.body.classList.add("dark");
    } else {
        document.body.classList.remove("dark");
    }

    const p = state.page;

    let v;

    if (p === "home") {
        v = home();
    } else if (p === "register") {
        v = register();
    } else if (p === "registerotp") {
        v = registerOtp();
    } else if (p === "registeremailotp") {
        v = registerEmailOtp();
    } else if (p === "registerpassword") {
        v = registerPassword();
    } else if (p === "registertype") {
        v = registerAccountType();
    } else if (p === "registercomplete") {
        v = registrationComplete();
    } else if (p === "login") {
        v = login();
    } else if (p === "loginotp") {
        v = loginOtp();
    } else if (p === "userselect") {
        v = credentialPage("Login to Patient", "User", "Patient");
    } else if (p === "ambselect") {
        v = selectPage(
            "Select Ambulance Role",
            [
                ["EV Doctor", "🩺", "Medical assessment & patient care"],
                ["EC Driver", "🚑", "Driving, GPS & route control"]
            ],
            "Ambulance"
        );
    } else if (p === "hospselect") {
        v = selectPage(
            "Select Hospital Role",
            [
                ["Registration", "🧾", "Patient registration"],
                ["Data Collection", "📋", "Emergency data"],
                ["Resource Management", "📦", "Beds, ICU & equipment"],
                ["ER Staff", "👨‍⚕️", "Emergency response"],
                ["Hospital Admin", "🏥", "Hospital administration"]
            ],
            "Hospital"
        );
    } else if (p === "adminlogin") {
        v = adminLogin();
    } else if (p === "trafficlogin") {
        v = credentialPage(
            "Login to City Traffic Control Room",
            "City Traffic Control Room",
            "Traffic Management"
        );
    } else if (p === "credentials") {
        v = credentialPage(
            "Login to " + state.subrole,
            state.role,
            state.subrole
        );
    } else {
        v = dashboard(state.role, state.subrole);
    }

    const app = document.getElementById("app");

    if (!app) {
        console.error("MEDRA: The #app element was not found.");
        return;
    }

    app.innerHTML = v;

    document.querySelectorAll(".resourceNav[data-resource-tab]")
        .forEach(button => {
            button.onclick = () => {
                const next = button.dataset.resourceTab;
                const current = state.dashboardSection || "Resource Management";

                state.resourceSectionHistory =
                    state.resourceSectionHistory || [];

                if (current !== next) {
                    state.resourceSectionHistory.push(current);
                }

                state.dashboardSection = next;
                state.page = "dashboard";

                render();
                window.scrollTo(0, 0);
            };
        });

    const resourceBackButton =
        document.querySelector(".resourceBackButton");

    if (resourceBackButton) {
        resourceBackButton.onclick = () => {
            state.resourceSectionHistory =
                state.resourceSectionHistory || [];

            state.dashboardSection =
                state.resourceSectionHistory.pop() || "Dashboard";

            state.page = "dashboard";

            render();
            window.scrollTo(0, 0);
        };
    }

    if (p === "registerpassword") {
        updatePasswordHints();
    }

    if (p === "dashboard" && document.getElementById("medraMap")) {
        setTimeout(initMedraMap, 50);
    }

    if (
        p === "dashboard" &&
        document.getElementById("patientEmergencyMap")
    ) {
        setTimeout(initPatientEmergencyMap, 80);
    }

    if (
        p === "dashboard" &&
        document.getElementById("driverEmergencyMap")
    ) {
        setTimeout(initDriverEmergencyMap, 80);
    }

    if (
        p === "dashboard" &&
        (
            document.getElementById("patientActiveEmergencyMap") ||
            document.getElementById("patientActiveRouteMap")
        )
    ) {
        setTimeout(initPatientActiveMaps, 80);
    }

    if (
        p === "dashboard" &&
        document.getElementById("doctorEmergencyMap")
    ) {
        setTimeout(initDoctorEmergencyMap, 100);
    }
}

render();
