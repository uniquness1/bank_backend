import { initializeFirebaseLite } from "firebase-solyte";
import config from "./config.mjs";

const firebase = initializeFirebaseLite(config);

const Auth = firebase.Auth;
const Firestore = firebase.Firestore;

export { Auth, Firestore };
