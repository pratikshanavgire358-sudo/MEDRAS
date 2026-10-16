/* =========================================================
   MEDRA Landing Page Interactions
   ========================================================= */

"use strict";

document.addEventListener("DOMContentLoaded", () => {
    // 1. Navigation buttons with data-action
    document.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const action = btn.getAttribute("data-action");
            if (action === "login") {
                window.location.href = "auth/login.html";
            } else if (action === "signup") {
                window.location.href = "auth/signup.html";
            }
        });
    });

    // 2. Theme Toggle
    const themeBtn = document.getElementById("themeButton");
    if (themeBtn) {
        themeBtn.addEventListener("click", () => {
            if (typeof toggleTheme === "function") {
                toggleTheme();
            }
        });
    }

    // 3. Flip Cards
    const flipCards = document.querySelectorAll(".flip-card");
    flipCards.forEach(card => {
        card.addEventListener("click", () => {
            card.classList.toggle("is-flipped");
            const isFlipped = card.classList.contains("is-flipped");
            card.setAttribute("aria-pressed", String(isFlipped));
        });
    });

    // 4. Role cards quick link
    document.querySelectorAll(".role-card").forEach((card, index) => {
        card.style.cursor = "pointer";
        card.addEventListener("click", () => {
            window.location.href = "auth/login.html";
        });
    });
});
