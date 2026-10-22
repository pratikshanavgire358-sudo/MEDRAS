# MEDRA ABHA Demo Module Patch

This patch adds a synthetic ABHA workflow to the existing MEDRAS_APPLICATION project.

## Included
- Patient ABHA UI: `pages/patient/abha.html`
- Patient UI logic: `js/patient/abha.js`
- Hospital shared-record UI: `pages/hospital/abha-records.html`
- Hospital UI logic: `js/hospital/abha-records.js`
- SQLAlchemy models for demo links and consent grants: `backend/app/models/abha.py`
- Extended `backend/app/routes/abdm.py`
- `main.py` imports the new models before `Base.metadata.create_all`
- Patient and hospital dashboard navigation links

## Important
This is a **synthetic demo only**, not real ABHA/ABDM identity verification or live health-record exchange. Use fake records only. Do not use this for clinical decisions or real patient information.

The consent workflow is a development prototype. Before production, implement official identity/consent integration, hospital-to-organization onboarding, stronger audit requirements, migrations, tests, and security review.

## Run
1. Back up your existing project or commit it to Git first.
2. Copy the files from this patch over the matching paths in your local `MEDRAS_APPLICATION` folder.
3. Check that your `backend/.env` is configured locally (the `.env` file is intentionally not included).
4. Start the backend from `backend`:
   `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload`
5. Log in to MEDRA in the browser first so `js/api.js` has a valid access token.
6. Open `pages/patient/abha.html` via VS Code Live Server. Do not open it as a `file://` page.
7. The backend startup calls `Base.metadata.create_all`, which should create the new `abha_demo_links` and `abha_consents` tables if your database user has table-creation permission.
8. In Swagger at `http://127.0.0.1:8000/docs`, test:
   - `GET /api/abdm/demo-options`
   - `POST /api/abdm/verify-demo`
   - `GET /api/abdm/my-profile`
   - `GET /api/abdm/health-records`
   - `POST /api/abdm/consents`
   - `GET /api/abdm/consents`
   - `POST /api/abdm/consents/{consent_id}/revoke`
   - `GET /api/abdm/shared-records` (authenticate as a hospital-role user)

## Demo identifiers
The JSON dataset in `backend/app/data/dummy_abha_patients.json` contains fake demo records. The UI loads the available test identifiers from the backend. These identifiers are not real ABHA numbers.

## Checks performed on this patch
- Python syntax compilation for the changed backend Python files.
- JSON syntax validation for the synthetic dataset.
- JavaScript syntax checks for the two new frontend scripts.
- No live PostgreSQL, authentication, browser, or end-to-end integration test was performed in this environment.
