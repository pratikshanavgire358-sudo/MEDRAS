"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    if (
        typeof requireRoleAuth === "function" &&
        !requireRoleAuth(["patient", "hospital", "ambulance", "admin"])
    ) return;

    const user = await loadAccountUser();
    if (!user) return;

    const dashboardLink = document.getElementById("accountDashboardLink");
    if (dashboardLink && typeof getRoleDashboardUrl === "function") {
        dashboardLink.href = `../../${getRoleDashboardUrl(user.role)}`;
    }

    if (document.getElementById("accountProfileForm")) {
        setupAccountProfile(user);
    }
    if (document.getElementById("themePreference")) {
        setupAccountSettings(user);
    }
});

async function loadAccountUser() {
    const message = document.getElementById("accountProfileMessage") ||
        document.getElementById("accountSettingsMessage");
    try {
        const user = await window.MedraAPI.get("/api/auth/me");
        const token = window.MedraAPI.getToken();
        window.MedraAPI.setAuthSession(token, user);
        document.getElementById("settingsUserName")?.replaceChildren(document.createTextNode(user.full_name || "—"));
        document.getElementById("settingsUserEmail")?.replaceChildren(document.createTextNode(user.email || "—"));
        document.getElementById("settingsUserRole")?.replaceChildren(document.createTextNode(user.role || "—"));
        return user;
    } catch (error) {
        if (message) {
            message.textContent = error.message || "Unable to load your account details.";
            message.classList.add("error");
            message.hidden = false;
        }
        return null;
    }
}

function setupAccountProfile(user) {
    const form = document.getElementById("accountProfileForm");
    const message = document.getElementById("accountProfileMessage");
    const submit = document.getElementById("accountProfileSave");
    form.elements.full_name.value = user.full_name || "";
    form.elements.mobile.value = user.mobile || "";
    form.elements.email.value = user.email || "";
    form.elements.role.value = user.role || "";

    form.addEventListener("submit", async event => {
        event.preventDefault();
        message.hidden = true;
        submit.disabled = true;
        const values = {
            full_name: form.elements.full_name.value.trim(),
            mobile: form.elements.mobile.value.trim() || null
        };
        try {
            const response = await window.MedraAPI.patch("/api/auth/profile", values);
            const token = window.MedraAPI.getToken();
            window.MedraAPI.setAuthSession(token, response.user);
            form.elements.full_name.value = response.user.full_name;
            form.elements.mobile.value = response.user.mobile || "";
            message.textContent = response.message || "Profile updated.";
            message.classList.remove("error");
            message.hidden = false;
        } catch (error) {
            message.textContent = error.message || "Unable to update your profile.";
            message.classList.add("error");
            message.hidden = false;
        } finally {
            submit.disabled = false;
        }
    });
}

function setupAccountSettings(user) {
    const themeSelect = document.getElementById("themePreference");
    const saveButton = document.getElementById("saveThemePreference");
    const message = document.getElementById("accountSettingsMessage");
    themeSelect.value = localStorage.getItem("medra_theme") || "light";

    saveButton.addEventListener("click", () => {
        const theme = themeSelect.value;
        if (!["light", "dark", "system"].includes(theme)) return;
        applyTheme(theme);
        message.textContent = `Theme preference saved for ${user.full_name || "your account"} in this browser.`;
        message.classList.remove("error");
        message.hidden = false;
    });
}
