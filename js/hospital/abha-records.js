"use strict";
document.addEventListener("DOMContentLoaded", async () => {
 const api=window.MedraAPI, status=document.getElementById("status"), records=document.getElementById("records");
 if(!api || !api.getToken()){status.textContent="Please log in with an authorized hospital account.";return;}
 const user=api.getCurrentUser();
 if(user && !["hospital","admin"].includes(user.role)){status.textContent="Hospital role required.";return;}
 try{
  const data=await api.get("/api/abdm/shared-records");
  if(!data.shared_records.length){status.textContent="No active consented demo records are shared with this hospital account.";return;}
  status.textContent=data.notice;
  records.innerHTML=data.shared_records.map(p=>{
   const entries=Object.entries(p.records||{}).map(([k,v])=>`<div class="item"><strong>${esc(k.replaceAll("_"," "))}</strong><div>${esc(Array.isArray(v)?(v.join(", ")||"None listed"):v??"Not provided")}</div></div>`).join("");
   return `<section class="card"><h2>${esc(p.patient_name)}</h2><p class="muted">Demo patient: ${esc(p.demo_patient_id)} · Consent #${p.consent_id}</p><p><strong>Purpose:</strong> ${esc(p.purpose)}</p>${entries}<p class="muted">Consent expires: ${esc(p.expires_at)}</p></section>`;
  }).join("");
 }catch(e){status.className="status err";status.textContent=e.message;}
});
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
