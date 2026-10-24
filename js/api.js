/* =========================================================
   MEDRA Centralized API Client & Session Manager
   ========================================================= */

const API_BASE_URL =
    window.MEDRA_API_BASE_URL ||
    "https://medra-backend-9rfy.onrender.com";

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

        let response;

        try {
            response = await fetch(url, {
                ...options,
                headers
            });
        } catch (error) {
            if (error instanceof TypeError) {
                const networkError = new Error(
                    "MEDRA did not return a response. Check your network and backend availability; " +
                    "a browser CORS block can look the same, so check the browser console for details."
                );
                networkError.status = 0;
                networkError.code = "NETWORK_OR_CORS_ERROR";
                networkError.cause = error;
                throw networkError;
            }

            throw error;
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const statusMessages = {
                401: "Your session is invalid or expired. Please log in again.",
                403: "Access denied: your account is not authorized for this action.",
                404: "The requested backend endpoint or resource was not found.",
                422: "The backend rejected the request. Check the submitted information.",
                500: "The backend encountered an internal error while processing the request."
            };

            let errorMessage = statusMessages[response.status] ||
                (response.status >= 500
                    ? `The backend returned a server error (${response.status}).`
                    : `The backend returned HTTP ${response.status}.`);

            if (data && typeof data.detail === "string") {
                errorMessage = data.detail;
            } else if (data && Array.isArray(data.detail)) {
                errorMessage = data.detail
                    .map(item => item.msg || "Validation error")
                    .join(" ");
            } else if (data && typeof data.message === "string") {
                errorMessage = data.message;
            }

            if (response.status === 401 && endpoint !== "/api/auth/login") {
                this.clearAuthSession();
                const currentPath = window.location.pathname;
                if (!currentPath.includes("/pages/auth/")) {
                    const loginPath = currentPath.includes("/pages/")
                        ? "../auth/login.html"
                        : "pages/auth/login.html";
                    window.location.href = new URL(loginPath, window.location.href).href;
                }
            }

            const requestError = new Error(`HTTP ${response.status}: ${errorMessage}`);
            requestError.status = response.status;
            requestError.data = data;
            throw requestError;
        }

        return data;
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
