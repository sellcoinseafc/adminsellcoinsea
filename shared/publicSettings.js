import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";

/**
 * Public order-page settings reader.
 *
 * READ ONLY by design. No Firestore write helpers are imported.
 * Firestore Rules remain the final authorization boundary.
 */
const SETTINGS_DOC = doc(db, "system", "settings");

export function subscribeToPublicSettings(onData, onError = null) {
  if (typeof onData !== "function") {
    throw new TypeError("subscribeToPublicSettings requires a callback.");
  }

  return onSnapshot(
    SETTINGS_DOC,
    (snapshot) => {
      if (!snapshot.exists()) {
        const error = new Error("Public settings document does not exist.");
        error.code = "settings/not-found";
        if (typeof onError === "function") onError(error);
        return;
      }

      onData(Object.freeze({ ...(snapshot.data() || {}) }));
    },
    (error) => {
      console.error(
        "Public settings listener error:",
        error?.code || error?.message || error
      );

      if (typeof onError === "function") onError(error);
    }
  );
}
