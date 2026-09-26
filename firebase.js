<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyCbd15z0Z1Snz_ogiXDagxCF0Q8lIsXQ1s",
    authDomain: "sellcoins-26318.firebaseapp.com",
    databaseURL: "https://sellcoins-26318-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "sellcoins-26318",
    storageBucket: "sellcoins-26318.firebasestorage.app",
    messagingSenderId: "88434852153",
    appId: "1:88434852153:web:59d105040e2345759fe8e8",
    measurementId: "G-QP7M0L8YES"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
