import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "sellcoins-26318.firebaseapp.com",
  projectId: "sellcoins-26318",
  storageBucket: "sellcoins-26318.firebasestorage.app",
  messagingSenderId: "88434852153",
  appId: "1:88434852153:web:59d105040e2345759fe8e8"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
