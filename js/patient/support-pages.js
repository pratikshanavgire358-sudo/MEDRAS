"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["patient"])) return;

    const user = window.MedraAPI?.getCurrentUser?.();
    const userName = document.getElementById("supportUserName");
    if (userName && user?.full_name) userName.textContent = user.full_name;

    document.getElementById("supportLogout")?.addEventListener("click", () => {
        if (typeof window.logoutMedra === "function") window.logoutMedra();
        else window.MedraAPI?.clearAuthSession?.();
    });

    if (document.getElementById("familyForm")) {
        await setupFamilyPage();
    } else if (document.getElementById("notificationsList")) {
        await setupNotificationsPage();
    }
});

function escapeSupportText(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function showSupportMessage(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", isError);
    element.hidden = false;
}

function hideSupportMessage(element) {
    if (element) element.hidden = true;
}

async function setupFamilyPage() {
    const form = document.getElementById("familyForm");
    const list = document.getElementById("familyList");
    const loading = document.getElementById("familyLoading");
    const empty = document.getElementById("familyEmpty");
    const message = document.getElementById("familyMessage");
    const saveButton = document.getElementById("familySaveButton");
    const cancelButton = document.getElementById("familyCancelEdit");
    const count = document.getElementById("familyMemberCount");
    let members = [];
    let editingId = null;

    function renderMembers() {
        loading.hidden = true;
        empty.hidden = members.length > 0;
        count.textContent = `${members.length} ${members.length === 1 ? "member" : "members"}`;
        list.innerHTML = members.map(member => `
            <article class="family-card">
                <div class="family-avatar" aria-hidden="true">${escapeSupportText(member.full_name.trim().charAt(0).toUpperCase())}</div>
                <div class="family-card-main">
                    <h3>${escapeSupportText(member.full_name)}</h3>
                    <p class="family-relation">${escapeSupportText(member.relationship)}</p>
                    ${member.mobile ? `<p class="family-contact"><i class="bi bi-telephone"></i> ${escapeSupportText(member.mobile)}</p>` : ""}
                    ${member.email ? `<p class="family-contact"><i class="bi bi-envelope"></i> ${escapeSupportText(member.email)}</p>` : ""}
                    <div class="family-card-actions">
                        <button type="button" class="family-card-action" data-edit-member="${member.id}"><i class="bi bi-pencil"></i> Edit</button>
                        <button type="button" class="family-card-action delete" data-delete-member="${member.id}"><i class="bi bi-trash"></i> Remove</button>
                    </div>
                </div>
            </article>`).join("");
    }

    async function loadMembers() {
        loading.hidden = false;
        empty.hidden = true;
        try {
            const response = await window.MedraAPI.get("/api/patient/family-members");
            members = Array.isArray(response?.family_members) ? response.family_members : [];
            renderMembers();
        } catch (error) {
            loading.hidden = true;
            showSupportMessage(message, error.message || "Unable to load family members.", true);
        }
    }

    function resetForm() {
        form.reset();
        editingId = null;
        document.getElementById("familyFormHeading").textContent = "Add a family member";
        saveButton.innerHTML = '<i class="bi bi-person-plus"></i> Add member';
        cancelButton.hidden = true;
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        hideSupportMessage(message);
        saveButton.disabled = true;
        const values = Object.fromEntries(new FormData(form).entries());
        for (const key of ["mobile", "email"]) {
            if (!values[key]) values[key] = null;
        }
        const isEditing = editingId !== null;
        const endpoint = isEditing
            ? `/api/patient/family-members/${editingId}`
            : "/api/patient/family-members";
        try {
            await window.MedraAPI.request(endpoint, {
                method: isEditing ? "PATCH" : "POST",
                body: values
            });
            resetForm();
            showSupportMessage(message, isEditing ? "Family member updated." : "Family member added.");
            await loadMembers();
        } catch (error) {
            showSupportMessage(message, error.message || "Unable to save this family member.", true);
        } finally {
            saveButton.disabled = false;
        }
    });

    cancelButton.addEventListener("click", resetForm);

    list.addEventListener("click", async event => {
        const editButton = event.target.closest("[data-edit-member]");
        const deleteButton = event.target.closest("[data-delete-member]");
        if (editButton) {
            const member = members.find(item => item.id === Number(editButton.dataset.editMember));
            if (!member) return;
            editingId = member.id;
            form.elements.full_name.value = member.full_name;
            form.elements.relationship.value = member.relationship;
            form.elements.mobile.value = member.mobile || "";
            form.elements.email.value = member.email || "";
            document.getElementById("familyFormHeading").textContent = "Edit family member";
            saveButton.innerHTML = '<i class="bi bi-check2"></i> Save changes';
            cancelButton.hidden = false;
            form.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (deleteButton) {
            const member = members.find(item => item.id === Number(deleteButton.dataset.deleteMember));
            if (!member || !window.confirm(`Remove ${member.full_name} from your family contacts?`)) return;
            deleteButton.disabled = true;
            try {
                await window.MedraAPI.request(
                    `/api/patient/family-members/${member.id}`,
                    { method: "DELETE" }
                );
                showSupportMessage(message, "Family member removed.");
                if (editingId === member.id) resetForm();
                await loadMembers();
            } catch (error) {
                deleteButton.disabled = false;
                showSupportMessage(message, error.message || "Unable to remove this family member.", true);
            }
        }
    });

    await loadMembers();
    await updateUnreadBadges();
}

async function setupNotificationsPage() {
    const list = document.getElementById("notificationsList");
    const loading = document.getElementById("notificationsLoading");
    const empty = document.getElementById("notificationsEmpty");
    const count = document.getElementById("unreadSummary");
    const markAllButton = document.getElementById("markAllReadButton");
    const message = document.getElementById("notificationsMessage");

    async function loadNotifications() {
        loading.hidden = false;
        empty.hidden = true;
        try {
            const response = await window.MedraAPI.get("/api/patient/notifications");
            const notifications = Array.isArray(response?.notifications) ? response.notifications : [];
            const unreadCount = Number(response?.unread_count) || 0;
            loading.hidden = true;
            empty.hidden = notifications.length > 0;
            count.textContent = `${unreadCount} unread`;
            markAllButton.disabled = unreadCount === 0;
            list.innerHTML = notifications.map(notification => {
                const isEmergency = String(notification.type).toUpperCase() === "EMERGENCY";
                const date = notification.created_at ? new Date(notification.created_at) : null;
                const dateText = date && Number.isFinite(date.getTime())
                    ? date.toLocaleString()
                    : "Date unavailable";
                return `
                    <li class="notification-item ${notification.is_read ? "" : "unread"} ${isEmergency ? "emergency" : ""}">
                        <i class="notification-icon bi ${isEmergency ? "bi-exclamation-triangle-fill" : "bi-bell-fill"}" aria-hidden="true"></i>
                        <div class="notification-body">
                            <h3>${escapeSupportText(notification.title)}</h3>
                            <p>${escapeSupportText(notification.message)}</p>
                            <div class="notification-meta">${escapeSupportText(dateText)}
                                <span class="notification-status">${notification.is_read ? "Read" : "Unread"}</span>
                            </div>
                        </div>
                        ${notification.can_mark_read && !notification.is_read
                            ? `<button type="button" class="support-secondary notification-read-button" data-read-notification="${notification.id}">Mark as read</button>`
                            : ""}
                    </li>`;
            }).join("");
            await updateUnreadBadges(unreadCount);
        } catch (error) {
            loading.hidden = true;
            showSupportMessage(message, error.message || "Unable to load notifications.", true);
        }
    }

    list.addEventListener("click", async event => {
        const button = event.target.closest("[data-read-notification]");
        if (!button) return;
        button.disabled = true;
        try {
            await window.MedraAPI.request(
                `/api/patient/notifications/${button.dataset.readNotification}/read`,
                { method: "PATCH" }
            );
            await loadNotifications();
        } catch (error) {
            button.disabled = false;
            showSupportMessage(message, error.message || "Unable to mark this notification as read.", true);
        }
    });

    markAllButton.addEventListener("click", async () => {
        markAllButton.disabled = true;
        try {
            await window.MedraAPI.request("/api/patient/notifications/read-all", { method: "POST" });
            await loadNotifications();
            showSupportMessage(message, "Your notifications are marked as read.");
        } catch (error) {
            showSupportMessage(message, error.message || "Unable to update notifications.", true);
            markAllButton.disabled = false;
        }
    });

    await loadNotifications();
}

async function updateUnreadBadges(knownCount) {
    const badges = document.querySelectorAll("[data-unread-count]");
    if (!badges.length) return;
    let unreadCount = knownCount;
    if (unreadCount === undefined) {
        try {
            const response = await window.MedraAPI.get("/api/patient/notifications");
            unreadCount = Number(response?.unread_count) || 0;
        } catch (error) {
            return;
        }
    }
    badges.forEach(badge => {
        badge.textContent = String(unreadCount);
        badge.hidden = unreadCount === 0;
    });
}
