"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const api = window.MedraAPI;
  if (!api || !api.getToken()) {
    setStatus("linkStatus", "Please log in to MEDRA before using this page.", "err");
    return;
  }
  const user = api.getCurrentUser();
  if (user && !["patient", "admin"].includes(user.role)) {
    setStatus("linkStatus", "This page is available to patient accounts.", "err");
    return;
  }
  document.getElementById("linkBtn").addEventListener("click", linkDemo);
  document.getElementById("refreshProfileBtn").addEventListener("click", loadProfile);
  document.getElementById("loadRecordsBtn").addEventListener("click", loadRecords);
  document.getElementById("grantBtn").addEventListener("click", grantConsent);
  document.getElementById("refreshConsentsBtn").addEventListener("click", loadConsents);
  await Promise.all([loadOptions(), loadProfile(), loadConsents()]);
});
function setStatus(id, text, type="") {
  const el=document.getElementById(id); if(!el)return;
  el.textContent=text; el.className="status"+(type?" "+type:"");
}
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
async function loadOptions() {
  try {
    const data=await MedraAPI.get("/api/abdm/demo-options");
    const select=document.getElementById("demoId");
    select.innerHTML="";
    data.patients.forEach(p=>{
      const opt=document.createElement("option");
      opt.value=p.abha_number;
      opt.textContent=`${p.display_name} — ${p.demo_patient_id} — ${p.abha_number}`;
      select.appendChild(opt);
    });
    setStatus("linkStatus", data.notice);
  } catch(e) { setStatus("linkStatus", e.message, "err"); }
}
async function linkDemo() {
  const btn=document.getElementById("linkBtn");
  if(!document.getElementById("confirmDemo").checked) {
    setStatus("linkStatus","Please confirm that this is synthetic demo data.", "err"); return;
  }
  btn.disabled=true;
  try {
    const data=await MedraAPI.post("/api/abdm/verify-demo",{
      abha_number:document.getElementById("demoId").value,
      consent_confirmed:true
    });
    setStatus("linkStatus",data.verified ? `${data.status}: ${data.notice}` : data.notice,data.verified?"ok":"err");
    await loadProfile();
    if(data.verified) await loadRecords();
  } catch(e) { setStatus("linkStatus",e.message,"err"); }
  finally { btn.disabled=false; }
}
async function loadProfile() {
  const el=document.getElementById("linkedProfile");
  try {
    const d=await MedraAPI.get("/api/abdm/my-profile");
    if(!d.linked) { el.innerHTML='<div class="empty">No demo record linked yet.</div>'; return; }
    el.innerHTML=`<div class="item"><strong>${escapeHtml(d.display_name)}</strong><div>Demo ID: ${escapeHtml(d.demo_patient_id)}</div><div>Identifier: ${escapeHtml(d.abha_number)}</div><div class="small">Linked: ${escapeHtml(d.linked_at || "Just now")}</div><p><span class="badge">SYNTHETIC DATA</span></p></div>`;
  } catch(e) { el.textContent=e.message; }
}
async function loadRecords() {
  try {
    const d=await MedraAPI.get("/api/abdm/health-records");
    const r=d.records || {};
    const rows=[
      ["Blood group",r.blood_group || "Not provided"],
      ["Allergies",(r.allergies || []).join(", ") || "None listed in demo dataset"],
      ["Medical history",(r.medical_history || []).join(", ") || "None listed in demo dataset"],
      ["Medications",(r.medications || []).join(", ") || "None listed in demo dataset"]
    ];
    document.getElementById("records").innerHTML=rows.map(([k,v])=>`<div class="item"><strong>${escapeHtml(k)}</strong><div>${escapeHtml(v)}</div></div>`).join("");
    setStatus("recordsStatus",d.notice,"ok");
  } catch(e) { document.getElementById("records").innerHTML='<div class="empty">No records available.</div>'; setStatus("recordsStatus",e.message,"err"); }
}
async function grantConsent() {
  const hospitalId=Number(document.getElementById("hospitalUserId").value);
  const purpose=document.getElementById("purpose").value.trim();
  const categories=[...document.querySelectorAll(".category:checked")].map(el=>el.value);
  if(!Number.isInteger(hospitalId)||hospitalId<1) { setStatus("consentStatus","Enter a valid hospital staff user ID.", "err"); return; }
  if(!categories.length) { setStatus("consentStatus","Select at least one record category.", "err"); return; }
  const btn=document.getElementById("grantBtn"); btn.disabled=true;
  try {
    const d=await MedraAPI.post("/api/abdm/consents",{
      hospital_user_id:hospitalId,purpose,record_categories:categories,
      duration_days:Number(document.getElementById("duration").value)
    });
    setStatus("consentStatus",`Consent #${d.id} granted for hospital user ${d.hospital_user_id}. Expires ${d.expires_at}.`, "ok");
    await loadConsents();
  } catch(e) { setStatus("consentStatus",e.message,"err"); }
  finally { btn.disabled=false; }
}
async function loadConsents() {
  const el=document.getElementById("consents");
  try {
    const data=await MedraAPI.get("/api/abdm/consents");
    if(!data.consents.length) { el.innerHTML='<div class="empty">No consent records yet.</div>'; return; }
    el.innerHTML=data.consents.map(c=>`<div class="item"><strong>Consent #${c.id} · ${escapeHtml(c.status)}</strong><div>${escapeHtml(c.hospital_name)} (user ${c.hospital_user_id})</div><div>Purpose: ${escapeHtml(c.purpose)}</div><div>Records: ${escapeHtml(c.record_categories.join(", "))}</div><div class="small">Expires: ${escapeHtml(c.expires_at || "—")}</div>${c.status==="ACTIVE"?`<button class="danger" type="button" data-revoke="${c.id}">Revoke access</button>`:""}</div>`).join("");
    el.querySelectorAll("[data-revoke]").forEach(btn=>btn.addEventListener("click",()=>revokeConsent(btn.dataset.revoke)));
  } catch(e) { el.textContent=e.message; }
}
async function revokeConsent(id) {
  try { const d=await MedraAPI.post(`/api/abdm/consents/${id}/revoke`,{}); setStatus("consentStatus",`Consent #${d.id} revoked.`, "ok"); await loadConsents(); }
  catch(e) { setStatus("consentStatus",e.message,"err"); }
}
