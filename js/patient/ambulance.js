/* =========================================================
   MEDRA - PATIENT AMBULANCE TRACKING
   Real Leaflet + OpenStreetMap Map
========================================================= */

document.addEventListener("DOMContentLoaded", function () {

    /* =====================================================
       1. MEDRA LOCATION DATA
    ====================================================== */

    // Patient location - Solapur
    const patientLocation = [17.659920, 75.906430];

    // Ambulance starting location
    const ambulanceLocation = [17.658600, 75.904600];

    // Destination hospital
    const hospitalLocation = [17.662500, 75.911000];


    /* =====================================================
       2. CHECK LEAFLET
    ====================================================== */

    if (typeof L === "undefined") {

        console.error("Leaflet library is not loaded.");

        showToast(
            "Map library could not be loaded.",
            "error"
        );

        return;
    }


    /* =====================================================
       3. CREATE MAP
    ====================================================== */

    const mapElement = document.getElementById("ambulanceMap");

    if (!mapElement) {

        console.error(
            "Element #ambulanceMap was not found."
        );

        return;
    }


    const map = L.map("ambulanceMap", {
        zoomControl: true,
        scrollWheelZoom: true
    }).setView(patientLocation, 15);


    /* =====================================================
       4. OPENSTREETMAP TILES
    ====================================================== */

   
L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
        maxZoom: 20,

        attribution:
            '&copy; OpenStreetMap contributors &copy; CARTO'
    }
).addTo(map);
    /* =====================================================
       5. CUSTOM ICONS
    ====================================================== */

    const patientIcon = L.divIcon({

        className: "leaflet-patient-marker",

        html: `
            <div class="custom-map-marker patient-map-marker">
                <i class="bi bi-person-fill"></i>
            </div>
        `,

        iconSize: [46, 46],

        iconAnchor: [23, 46],

        popupAnchor: [0, -42]
    });


    const ambulanceIcon = L.divIcon({

        className: "leaflet-ambulance-marker",

        html: `
            <div class="custom-map-marker ambulance-map-marker">
                <i class="bi bi-truck-front-fill"></i>
            </div>
        `,

        iconSize: [52, 52],

        iconAnchor: [26, 52],

        popupAnchor: [0, -48]
    });


    const hospitalIcon = L.divIcon({

        className: "leaflet-hospital-marker",

        html: `
            <div class="custom-map-marker hospital-map-marker">
                <i class="bi bi-hospital-fill"></i>
            </div>
        `,

        iconSize: [46, 46],

        iconAnchor: [23, 46],

        popupAnchor: [0, -42]
    });


    /* =====================================================
       6. PATIENT MARKER
    ====================================================== */

    const patientMarker = L.marker(
        patientLocation,
        {
            icon: patientIcon
        }
    )
    .addTo(map)
    .bindPopup(`
        <div class="medra-map-popup">

            <strong>
                <i class="bi bi-person-fill"></i>
                Your Location
            </strong>

            <p>
                Emergency patient location
            </p>

        </div>
    `);


    /* =====================================================
       7. AMBULANCE MARKER
    ====================================================== */

    const ambulanceMarker = L.marker(
        ambulanceLocation,
        {
            icon: ambulanceIcon
        }
    )
    .addTo(map)
    .bindPopup(`
        <div class="medra-map-popup">

            <strong>
                <i class="bi bi-truck-front-fill"></i>
                Ambulance AMB-102
            </strong>

            <p>
                Status:
                <b>En Route</b>
            </p>

            <p>
                Emergency Response Team
            </p>

        </div>
    `);


    /* =====================================================
       8. HOSPITAL MARKER
    ====================================================== */

    const hospitalMarker = L.marker(
        hospitalLocation,
        {
            icon: hospitalIcon
        }
    )
    .addTo(map)
    .bindPopup(`
        <div class="medra-map-popup">

            <strong>
                <i class="bi bi-hospital-fill"></i>
                City Civil Hospital
            </strong>

            <p>
                Emergency destination
            </p>

            <p>
                Hospital status:
                <b>Ready</b>
            </p>

        </div>
    `);


    /* =====================================================
       9. ROUTE LINE
    ====================================================== */

    const routeLine = L.polyline(
    [
        ambulanceLocation,
        patientLocation,
        hospitalLocation
    ],
    {
        color: "#08a878",
        weight: 5,
        opacity: 0.9,
        dashArray: "12 8",
        lineJoin: "round",
        lineCap: "round"
    }
).addTo(map);

    /* =====================================================
       10. FIT MAP TO ALL MARKERS
    ====================================================== */

    const routeBounds = L.latLngBounds([

        ambulanceLocation,
        patientLocation,
        hospitalLocation

    ]);

    map.fitBounds(routeBounds, {
        padding: [50, 50]
    });


    /* =====================================================
       11. DISTANCE CALCULATION
    ====================================================== */

    function calculateDistance(
        lat1,
        lon1,
        lat2,
        lon2
    ) {

        const R = 6371;

        const dLat =
            (lat2 - lat1) *
            Math.PI / 180;

        const dLon =
            (lon2 - lon1) *
            Math.PI / 180;


        const a =
            Math.sin(dLat / 2) *
            Math.sin(dLat / 2) +

            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *

            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);


        const c =
            2 *
            Math.atan2(
                Math.sqrt(a),
                Math.sqrt(1 - a)
            );


        return R * c;
    }


    /* =====================================================
       12. UPDATE DISTANCE
    ====================================================== */

    function updateDistance() {

        const distance = calculateDistance(

            ambulanceLocation[0],
            ambulanceLocation[1],

            patientLocation[0],
            patientLocation[1]

        );


        const distanceElement =
            document.getElementById("distanceValue");


        if (distanceElement) {

            distanceElement.textContent =
                distance.toFixed(2) + " km";
        }


        return distance;
    }


    updateDistance();


    /* =====================================================
       13. ETA
    ====================================================== */

    function updateETA() {

        const distance =
            calculateDistance(

                ambulanceLocation[0],
                ambulanceLocation[1],

                patientLocation[0],
                patientLocation[1]
            );


        // Demo average emergency speed
        const averageSpeed = 40;

        const etaMinutes =
            Math.max(
                1,
                Math.round(
                    (distance / averageSpeed) * 60
                )
            );


        const etaValue =
            document.getElementById("etaValue");

        const detailEta =
            document.getElementById("detailEta");


        if (etaValue) {

            etaValue.textContent =
                String(etaMinutes).padStart(2, "0");
        }


        if (detailEta) {

            detailEta.textContent =
                etaMinutes;
        }

    }


    updateETA();


    /* =====================================================
       14. MY LOCATION BUTTON
    ====================================================== */

    const myLocationButton =
        document.getElementById(
            "myLocationButton"
        );


    if (myLocationButton) {

        myLocationButton.addEventListener(
            "click",
            function () {

                map.flyTo(
                    patientLocation,
                    17,
                    {
                        duration: 1.2
                    }
                );

                patientMarker.openPopup();

            }
        );

    }


    /* =====================================================
       15. REFRESH TRACKING
    ====================================================== */

    const refreshButton =
        document.getElementById(
            "refreshTracking"
        );


    if (refreshButton) {

        refreshButton.addEventListener(
            "click",
            function () {

                refreshButton.innerHTML = `
                    <i class="bi bi-arrow-repeat"></i>
                    Updating...
                `;


                setTimeout(function () {

                    updateDistance();

                    updateETA();


                    refreshButton.innerHTML = `
                        <i class="bi bi-check-lg"></i>
                        Updated
                    `;


                    showToast(
                        "Ambulance location updated.",
                        "success"
                    );


                    setTimeout(function () {

                        refreshButton.innerHTML = `
                            <i class="bi bi-arrow-clockwise"></i>
                            Refresh
                        `;

                    }, 1500);


                }, 800);

            }
        );

    }


    /* =====================================================
       16. CALL DRIVER
    ====================================================== */

    const callDriverButton =
        document.getElementById(
            "callDriverButton"
        );


    if (callDriverButton) {

        callDriverButton.addEventListener(
            "click",
            function () {

                window.location.href =
                    "tel:+919999999999";

            }
        );

    }


    /* =====================================================
       17. SHARE LOCATION
    ====================================================== */

    const shareLocationButton =
        document.getElementById(
            "shareLocationButton"
        );


    if (shareLocationButton) {

        shareLocationButton.addEventListener(
            "click",
            async function () {

                const locationText =
                    "MEDRA Emergency Location\n" +
                    "Patient: Solapur\n" +
                    "Ambulance: AMB-102";


                try {

                    if (
                        navigator.clipboard
                    ) {

                        await navigator.clipboard.writeText(
                            locationText
                        );

                        showToast(
                            "Location copied successfully.",
                            "success"
                        );

                    }

                }

                catch (error) {

                    console.error(error);

                    showToast(
                        "Unable to share location.",
                        "error"
                    );

                }

            }
        );

    }


    /* =====================================================
       18. NOTIFICATION BUTTON
    ====================================================== */

    const notificationButton =
        document.getElementById(
            "notificationButton"
        );


    if (notificationButton) {

        notificationButton.addEventListener(
            "click",
            function () {

                window.location.href =
                    "notifications.html";

            }
        );

    }


    /* =====================================================
       19. LOGOUT
    ====================================================== */

    const logoutButton =
        document.getElementById(
            "logoutButton"
        );


    if (logoutButton) {

        logoutButton.addEventListener(
            "click",
            function () {

                sessionStorage.removeItem(
                    "medraAuthenticated"
                );

                sessionStorage.removeItem(
                    "medraRole"
                );

                window.location.href =
                    "../auth/login.html";

            }
        );

    }


    /* =====================================================
       20. SIMULATED LIVE AMBULANCE MOVEMENT
       
       DEMO ONLY.
       Later replace this with WebSocket GPS data.
    ====================================================== */

    let progress = 0;


    function simulateAmbulanceMovement() {

        progress += 0.015;


        if (progress >= 1) {

            progress = 0;

        }


        const lat =
            ambulanceLocation[0] +
            (
                patientLocation[0] -
                ambulanceLocation[0]
            ) * progress;


        const lng =
            ambulanceLocation[1] +
            (
                patientLocation[1] -
                ambulanceLocation[1]
            ) * progress;


        ambulanceMarker.setLatLng([
            lat,
            lng
        ]);


        /* Update speed */

        const speedElement =
            document.getElementById(
                "speedValue"
            );


        if (speedElement) {

            const speed =
                38 +
                Math.floor(
                    Math.random() * 10
                );

            speedElement.textContent =
                speed + " km/h";

        }

    }


    /*
       Move ambulance every 5 seconds.
       This is only for frontend demonstration.
    */

    setInterval(
        simulateAmbulanceMovement,
        5000
    );


    /* =====================================================
       21. TOAST FUNCTION
    ====================================================== */

    function showToast(
        message,
        type = "success"
    ) {

        let toast =
            document.getElementById(
                "medraToast"
            );


        if (!toast) {

            toast =
                document.createElement(
                    "div"
                );

            toast.id =
                "medraToast";

            toast.className =
                "medra-toast";

            document.body.appendChild(
                toast
            );

        }


        toast.className =
            "medra-toast " + type;


        toast.innerHTML = `

            <i class="bi ${
                type === "success"
                    ? "bi-check-circle-fill"
                    : "bi-exclamation-circle-fill"
            }"></i>

            <span>
                ${message}
            </span>

        `;


        toast.classList.add(
            "show"
        );


        setTimeout(function () {

            toast.classList.remove(
                "show"
            );

        }, 3000);

    }


    /* =====================================================
       22. MAP LOADED
    ====================================================== */

    console.log(
        "MEDRA real Leaflet map initialized."
    );

    console.log(
        "Patient:",
        patientLocation
    );

    console.log(
        "Ambulance:",
        ambulanceLocation
    );

    console.log(
        "Hospital:",
        hospitalLocation
    );

});