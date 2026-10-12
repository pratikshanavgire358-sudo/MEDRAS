
import { initializeApp } from
    "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";

import {
    getAuth,
    GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDpE2TBPGKPZKqDcvI8tmHRZaUtgSeeEyk",
    authDomain: "medra-358.firebaseapp.com",
    projectId: "medra-358",
    storageBucket: "medra-358.firebasestorage.app",
    messagingSenderId: "83098804752",
    appId: "1:83098804752:web:aff4f15196a9442fa06095",
    measurementId: "G-HW5T194B6T"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();