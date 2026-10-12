/* =========================================================
   MEDRA PATIENT VITALS
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    loadPatientName();

    setupNotifications();

    setupLogout();

    startDemoMonitoring();

});


/* =========================================================
   PATIENT NAME
   ========================================================= */

function loadPatientName() {

    const patientName =
        document.getElementById("patientName");

    const savedName =
        localStorage.getItem("medraSignupName");

    if (patientName && savedName) {

        patientName.textContent = savedName;

    }

}


/* =========================================================
   NOTIFICATIONS
   ========================================================= */

function setupNotifications() {

    const button =
        document.getElementById("notificationButton");

    if (!button) return;

    button.addEventListener("click", () => {

        window.location.href =
            "notifications.html";

    });

}


/* =========================================================
   LOGOUT
   ========================================================= */

function setupLogout() {

    const button =
        document.getElementById("logoutButton");

    if (!button) return;

    button.addEventListener("click", () => {

        sessionStorage.removeItem("medraAuthenticated");
        sessionStorage.removeItem("medraRole");

        window.location.href =
            "../auth/login.html";

    });

}


/* =========================================================
   DEMO MONITORING
   ========================================================= */

function startDemoMonitoring() {

    /*
       Demo only.

       Later:
       FastAPI
          ↓
       WebSocket
          ↓
       Patient Vitals
    */

    setInterval(() => {

        updateDemoVitals();

    }, 5000);

}


/* =========================================================
   UPDATE DEMO VITALS
   ========================================================= */

function updateDemoVitals() {

    const heartRate =
        document.getElementById("heartRate");

    const spo2 =
        document.getElementById("spo2");

    const temperature =
        document.getElementById("temperature");

    const respiratoryRate =
        document.getElementById("respiratoryRate");

    const glucose =
        document.getElementById("glucose");

    const lastReading =
        document.getElementById("lastReading");


    /*
       Small changes only so the
       dashboard looks like live data.
    */

    if (heartRate) {

        const value =
            76 + Math.floor(Math.random() * 7);

        heartRate.textContent = value;

    }


    if (spo2) {

        const value =
            97 + Math.floor(Math.random() * 3);

        spo2.textContent = value;

    }


    if (temperature) {

        const value =
            (98.1 + Math.random() * 0.7)
            .toFixed(1);

        temperature.textContent = value;

    }


    if (respiratoryRate) {

        const value =
            15 + Math.floor(Math.random() * 4);

        respiratoryRate.textContent = value;

    }


    if (glucose) {

        const value =
            92 + Math.floor(Math.random() * 11);

        glucose.textContent = value;

    }


    if (lastReading) {

        lastReading.textContent =
            "Just now";

    }

}