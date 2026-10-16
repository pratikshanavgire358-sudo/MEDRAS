/* =========================================================
   MEDRA PATIENT VITALS CONTROLLER
   ========================================================= */

"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof requireRoleAuth === "function" && !requireRoleAuth(["patient", "admin"])) {
        return;
    }

    await loadVitals();
    setupVitalsLogger();
});

async function loadVitals() {
    const api = window.MedraAPI;
    if (!api) return;

    try {
        const data = await api.get("/api/patient/vitals");
        const vitals = data.vitals || [];
        renderVitalsCards(vitals);
        renderVitalsTable(vitals);
    } catch (err) {
        console.error("Vitals load error:", err);
        if (typeof showNotification === "function") {
            showNotification("Unable to load latest vitals from database.", "warning");
        }
    }
}

function renderVitalsCards(vitals) {
    if (vitals.length === 0) return;
    const latest = vitals[0];

    const hr = document.getElementById("heartRateValue") || document.getElementById("heartRate");
    const bp = document.getElementById("bpValue") || document.getElementById("bloodPressure");
    const spo2 = document.getElementById("spo2Value") || document.getElementById("spO2");
    const temp = document.getElementById("tempValue") || document.getElementById("temperature");

    if (hr && latest.heart_rate) hr.textContent = latest.heart_rate;
    if (bp && latest.blood_pressure) bp.textContent = latest.blood_pressure;
    if (spo2 && latest.sp_o2) spo2.textContent = `${latest.sp_o2}%`;
    if (temp && latest.temperature) temp.textContent = `${latest.temperature} °C`;
}

function renderVitalsTable(vitals) {
    let tbody = document.getElementById("vitalsTableBody") || document.querySelector("table tbody");
    if (!tbody) return;

    if (vitals.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">No vitals observations recorded yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = vitals.map(v => `
        <tr>
            <td>${v.recorded_at ? new Date(v.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : 'Recent'}</td>
            <td><strong>${v.heart_rate || '-'}</strong> bpm</td>
            <td><strong>${v.blood_pressure || '-'}</strong> mmHg</td>
            <td><strong>${v.sp_o2 || '-'}</strong>%</td>
            <td>${v.temperature ? v.temperature + ' °C' : '-'}</td>
            <td>${v.respiratory_rate || '-'} /min</td>
            <td><span class="badge bg-light text-dark border">${v.source}</span></td>
        </tr>
    `).join("");
}

function setupVitalsLogger() {
    // Inject Log Vitals button/modal if not present
    let logBtn = document.getElementById("logVitalsBtn");
    if (!logBtn) {
        const topActions = document.querySelector(".top-actions") || document.querySelector(".section-header");
        if (topActions) {
            logBtn = document.createElement("button");
            logBtn.id = "logVitalsBtn";
            logBtn.className = "btn btn-primary btn-sm";
            logBtn.style.cssText = "margin-left: 10px; background: #06b878; border: none; padding: 6px 14px; border-radius: 8px; color: #fff; font-weight: 600;";
            logBtn.textContent = "+ Record Clinical Vitals";
            topActions.appendChild(logBtn);
        }
    }

    if (logBtn) {
        logBtn.addEventListener("click", () => {
            promptLogVitals();
        });
    }
}

async function promptLogVitals() {
    const hr = prompt("Enter Heart Rate (bpm, e.g. 75):", "78");
    if (hr === null) return;

    const sys = prompt("Enter Blood Pressure Systolic (mmHg, e.g. 120):", "120");
    if (sys === null) return;

    const dia = prompt("Enter Blood Pressure Diastolic (mmHg, e.g. 80):", "80");
    if (dia === null) return;

    const spo2 = prompt("Enter Oxygen Saturation SpO2 (%, e.g. 98):", "98");
    if (spo2 === null) return;

    const temp = prompt("Enter Body Temperature (°C, e.g. 36.8):", "36.8");
    if (temp === null) return;

    const body = {
        heart_rate: parseInt(hr),
        blood_pressure_systolic: parseInt(sys),
        blood_pressure_diastolic: parseInt(dia),
        sp_o2: parseInt(spo2),
        temperature: parseFloat(temp),
        respiratory_rate: 16,
        source: "PATIENT_INPUT"
    };

    try {
        const api = window.MedraAPI;
        await api.post("/api/patient/vitals", body);
        if (typeof showNotification === "function") {
            showNotification("Clinical vitals saved to PostgreSQL database!", "success");
        } else {
            alert("Vitals saved successfully!");
        }
        await loadVitals();
    } catch (e) {
        alert(e.message || "Failed to record vitals");
    }
}