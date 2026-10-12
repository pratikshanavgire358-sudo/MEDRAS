/* =========================================================
   MEDRA PATIENT - EMERGENCY PAGE
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    loadPatient();

    setupTheme();

    setupSOS();

    setupLocation();

});



/* =========================================================
   PATIENT
   ========================================================= */

function loadPatient() {

    const name =
        sessionStorage.getItem("medraSignupName") ||
        "Patient";


    const firstName =
        name.split(" ")[0];


    const sidebarName =
        document.getElementById("sidebarUserName");

    const topName =
        document.getElementById("topUserName");

    const sidebarAvatar =
        document.getElementById("sidebarAvatar");

    const topAvatar =
        document.getElementById("topAvatar");


    if (sidebarName) {
        sidebarName.textContent = name;
    }


    if (topName) {
        topName.textContent = name;
    }


    const initial =
        firstName.charAt(0).toUpperCase();


    if (sidebarAvatar) {
        sidebarAvatar.textContent = initial;
    }


    if (topAvatar) {
        topAvatar.textContent = initial;
    }

}



/* =========================================================
   SOS
   ========================================================= */

function setupSOS() {

    const sendButton =
        document.getElementById("sendSOSButton");

    const modal =
        document.getElementById("sosModal");

    const cancel =
        document.getElementById("cancelSOS");

    const confirm =
        document.getElementById("confirmSOS");


    sendButton.addEventListener(
        "click",
        () => {

            const type =
                document.getElementById(
                    "emergencyType"
                ).value;


            if (!type) {

                showMessage(
                    "Please select the emergency type first."
                );

                return;

            }


            modal.classList.add("show");

        }
    );


    cancel.addEventListener(
        "click",
        () => {

            modal.classList.remove("show");

        }
    );


    confirm.addEventListener(
        "click",
        createEmergency
    );

}



/* =========================================================
   CREATE EMERGENCY
   ========================================================= */

function createEmergency() {

    const modal =
        document.getElementById("sosModal");

    const state =
        document.getElementById("emergencyState");


    modal.classList.remove("show");


    state.textContent =
        "Emergency Created";


    state.style.background =
        "#fff0f2";


    state.style.color =
        "#d63848";


    showMessage(
        "Emergency alert created successfully."
    );


    /*
       CURRENTLY:

       This is frontend demo behavior.

       NEXT BACKEND STEP:

       POST /api/v1/emergencies

       {
           emergency_type,
           description,
           latitude,
           longitude
       }

       FastAPI will create the emergency
       in PostgreSQL.
    */


    console.log(
        "MEDRA EVENT: emergency.created"
    );

}



/* =========================================================
   LOCATION
   ========================================================= */

function setupLocation() {

    const button =
        document.getElementById(
            "getLocationButton"
        );


    button.addEventListener(
        "click",
        () => {

            if (!navigator.geolocation) {

                showMessage(
                    "Geolocation is not supported."
                );

                return;

            }


            button.disabled = true;

            button.innerHTML =
                '<i class="bi bi-arrow-repeat"></i> Getting...';


            navigator.geolocation.getCurrentPosition(

                position => {

                    const latitude =
                        position.coords.latitude.toFixed(6);

                    const longitude =
                        position.coords.longitude.toFixed(6);


                    document.getElementById(
                        "locationText"
                    ).textContent =
                        `${latitude}, ${longitude}`;


                    button.disabled = false;

                    button.innerHTML =
                        '<i class="bi bi-check-circle"></i> Located';


                    showMessage(
                        "Location captured successfully."
                    );

                },


                () => {

                    button.disabled = false;

                    button.innerHTML =
                        '<i class="bi bi-crosshair"></i> Get Location';


                    showMessage(
                        "Unable to retrieve your location."
                    );

                }

            );

        }
    );

}



/* =========================================================
   THEME
   ========================================================= */

function setupTheme() {

    const button =
        document.getElementById("themeButton");


    const saved =
        localStorage.getItem("medraTheme");


    if (saved === "dark") {

        document.body.classList.add("dark");

        button.innerHTML =
            '<i class="bi bi-sun"></i>';

    }


    button.addEventListener(
        "click",
        () => {

            document.body.classList.toggle("dark");


            const dark =
                document.body.classList.contains("dark");


            localStorage.setItem(
                "medraTheme",
                dark ? "dark" : "light"
            );


            button.innerHTML =
                dark
                ? '<i class="bi bi-sun"></i>'
                : '<i class="bi bi-moon"></i>';

        }
    );

}



/* =========================================================
   MESSAGE
   ========================================================= */

function showMessage(message) {

    const toast =
        document.createElement("div");


    toast.style.cssText = `
        position:fixed;
        right:25px;
        bottom:25px;
        z-index:3000;
        padding:13px 18px;
        border-radius:9px;
        background:#06273a;
        color:white;
        font-size:12px;
        box-shadow:0 10px 30px rgba(0,0,0,.2);
    `;


    toast.textContent =
        message;


    document.body.appendChild(toast);


    setTimeout(() => {

        toast.remove();

    }, 3000);

}



/* =========================================================
   LOGOUT
   ========================================================= */

function logoutPatient() {

    sessionStorage.removeItem(
        "medraAuthenticated"
    );

    sessionStorage.removeItem(
        "medraRole"
    );


    window.location.href =
        "../auth/login.html";

}