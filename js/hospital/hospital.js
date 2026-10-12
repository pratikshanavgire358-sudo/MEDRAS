"use strict";

document.addEventListener("DOMContentLoaded", () => {

    // ==========================================
    // 1. DASHBOARD REFRESH
    // ==========================================

    const refreshButton = document.getElementById("refreshDashboard");

    if (refreshButton) {
        refreshButton.addEventListener("click", () => {

            refreshButton.disabled = true;
            refreshButton.textContent = "Refreshing...";

            window.setTimeout(() => {

                refreshButton.disabled = false;
                refreshButton.textContent = "Refresh";

                window.alert(
                    "Demo dashboard refreshed.\n\n" +
                    "Live hospital data integration is not enabled yet."
                );

            }, 350);
        });
    }


    // ==========================================
    // 2. HOSPITAL PROFILE
    // ==========================================

    const profileButton = document.getElementById("profileButton");

    if (profileButton) {
        profileButton.addEventListener("click", () => {

            window.alert(
                "Hospital profile settings will be available " +
                "through the hospital administration module."
            );

        });
    }


    // ==========================================
    // 3. MOBILE SIDEBAR
    // ==========================================

    const menuButton = document.getElementById("hospitalMenuButton");
    const sidebar = document.querySelector(".hospital-sidebar");

    if (menuButton && sidebar) {

        menuButton.addEventListener("click", () => {

            const isOpen = sidebar.classList.toggle("open");

            menuButton.setAttribute(
                "aria-expanded",
                String(isOpen)
            );

        });

    }


    // ==========================================
    // 4. ACTIVE SIDEBAR LINK
    // ==========================================

    const currentPage = window.location.pathname
        .split("/")
        .pop();

    document.querySelectorAll(
        ".hospital-navigation .nav-link"
    ).forEach((link) => {

        const linkPage = link.getAttribute("href");

        if (linkPage === currentPage) {

            link.classList.add("active");

            link.setAttribute(
                "aria-current",
                "page"
            );

        } else {

            link.classList.remove("active");
            link.removeAttribute("aria-current");

        }

    });


    // ==========================================
    // 5. MEDRAS THEME MANAGER
    // System / Light / Dark
    // ==========================================
// MEDRAS Theme Manager
const themeSelect = document.getElementById("hospitalThemeSelect");

const THEME_KEY = "medra_theme";

function applyTheme(theme) {
    let effectiveTheme = theme;

    if (theme === "system") {
        effectiveTheme = window.matchMedia(
            "(prefers-color-scheme: dark)"
        ).matches ? "dark" : "light";
    }

    document.documentElement.setAttribute(
        "data-theme",
        effectiveTheme
    );

    document.body.setAttribute(
        "data-theme",
        effectiveTheme
    );

    console.log("MEDRAS theme applied:", theme, effectiveTheme);
}

let savedTheme = "system";

try {
    const storedTheme = localStorage.getItem(THEME_KEY);

    if (["system", "light", "dark"].includes(storedTheme)) {
        savedTheme = storedTheme;
    }
} catch (error) {
    console.warn("Unable to read saved theme.");
}

if (themeSelect) {
    themeSelect.value = savedTheme;

    themeSelect.addEventListener("change", () => {
        const selectedTheme = themeSelect.value;

        if (!["system", "light", "dark"].includes(selectedTheme)) {
            return;
        }

        try {
            localStorage.setItem(THEME_KEY, selectedTheme);
        } catch (error) {
            console.warn("Unable to save theme.");
        }

        applyTheme(selectedTheme);
    });
} else {
    console.error("Theme selector not found: hospitalThemeSelect");
}

const systemTheme = window.matchMedia(
    "(prefers-color-scheme: dark)"
);

systemTheme.addEventListener("change", () => {
    if (themeSelect && themeSelect.value === "system") {
        applyTheme("system");
    }
});

applyTheme(savedTheme);


    function saveSelectedTheme(theme) {

        selectedTheme = theme;

        try {

            localStorage.setItem(
                themeStorageKey,
                selectedTheme
            );

        } catch (error) {

            console.warn(
                "MEDRAS could not save the theme preference."
            );

        }

        applyHospitalTheme();

    }


    // Initialize the saved theme.
    applyHospitalTheme();


    // Handle user selection.
    if (themeSelect) {

        themeSelect.addEventListener("change", () => {

            const newTheme = themeSelect.value;

            if (
                ["system", "light", "dark"].includes(newTheme)
            ) {

                saveSelectedTheme(newTheme);

            }

        });

    }


    // Automatically update when Windows appearance changes.
    systemThemeQuery.addEventListener("change", () => {

        if (selectedTheme === "system") {
            applyHospitalTheme();
        }

    });

});