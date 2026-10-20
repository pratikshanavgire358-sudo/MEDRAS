/* =========================================================
   MEDRA Centralized API Client & Session Manager
   ========================================================= */

const API_BASE_URL = window.MEDRA_API_BASE_URL || "https://medra-backend-9rfy.onrender.com";
const MedraAPI = {
    baseUrl: API_BASE_URL,

    // Session Management
    getToken() {
        return sessionStorage.getItem("medra_access_token") || localStorage.getItem("medra_access_token");
    },

    setAuthSession(token, user) {
        sessionStorage.setItem("medra_access_token", token);
        sessionStorage.setItem("medra_user", JSON.stringify(user));
        // Backward compatibility
        sessionStorage.setItem("medraAccessToken", token);
        sessionStorage.setItem("medraUser", JSON.stringify(user));
        localStorage.setItem("medra_role", user.role);
        localStorage.setItem("medra_name", user.full_name);
    },

    clearAuthSession() {
        sessionStorage.removeItem("medra_access_token");
        sessionStorage.removeItem("medra_user");
        sessionStorage.removeItem("medraAccessToken");
        sessionStorage.removeItem("medraUser");
        sessionStorage.removeItem("medraAuthenticated");
        sessionStorage.removeItem("medraRole");
        localStorage.removeItem("medra_access_token");
        localStorage.removeItem("medra_user");
        localStorage.removeItem("medra_role");
        localStorage.removeItem("medra_name");
    },

    getCurrentUser() {
        try {
            const raw = sessionStorage.getItem("medra_user");
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    },

    // Core Fetch Wrapper
    async request(endpoint, options = {}) {
        const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint}`;
        const headers = {
            "Accept": "application/json",
            ...(options.headers || {})
        };

        const token = this.getToken();
        if (token && !headers["Authorization"]) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
            headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                let errorMsg = "An error occurred";
                if (data && typeof data.detail === "string") {
                    errorMsg = data.detail;
                } else if (data && Array.isArray(data.detail)) {
                    errorMsg = data.detail.map(d => d.msg || "Validation error").join(" ");
                } else if (data && data.message) {
                    errorMsg = data.message;
                } else if (response.status === 401) {
                    errorMsg = "Your session has expired. Please log in again.";
                } else if (response.status === 403) {
                    errorMsg = "Access denied: You do not have permission for this action.";
                } else if (response.status === 404) {
                    errorMsg = "Requested resource not found.";
                } else if (response.status === 503) {
                    errorMsg = "Database or server service unavailable.";
                }

                const err = new Error(errorMsg);
                err.status = response.status;
                err.data = data;
                throw err;
            }

            return data;
        } catch (error) {
            if (error.name === "TypeError" && error.message.includes("fetch")) {
                const networkErr = new Error("Unable to connect to MEDRA backend. Please ensure FastAPI server is running on http://127.0.0.1:8000.");
                networkErr.status = 0;
                throw networkErr;
            }
            throw error;
        }
    },

    get(endpoint, headers = {}) {
        return this.request(endpoint, { method: "GET", headers });
    },

    post(endpoint, body, headers = {}) {
        return this.request(endpoint, { method: "POST", body, headers });
    },

    put(endpoint, body, headers = {}) {
        return this.request(endpoint, { method: "PUT", body, headers });
    },

    patch(endpoint, body, headers = {}) {
        return this.request(endpoint, { method: "PATCH", body, headers });
    },

    delete(endpoint, headers = {}) {
        return this.request(endpoint, { method: "DELETE", headers });
    }
};

window.MedraAPI = MedraAPI;
