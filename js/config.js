// ============================================================================
//  FILL THIS IN. See FIREBASE-SETUP.md (about 5 minutes).
//  Until then the app runs in local demo mode: everything is saved in this
//  browser only and nobody else can see it.
// ============================================================================

// Firebase console > Project settings > General > Your apps > </> > config.
// These values are public by design; firestore.rules does the protecting.
export const firebaseConfig = {
  apiKey: "PASTE_ME",
  authDomain: "PASTE_ME",
  projectId: "PASTE_ME",
  storageBucket: "PASTE_ME",
  messagingSenderId: "PASTE_ME",
  appId: "PASTE_ME",
};

export const isConfigured = firebaseConfig.apiKey !== "PASTE_ME";
