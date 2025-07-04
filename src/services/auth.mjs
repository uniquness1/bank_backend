import dontenv from "dotenv"
import admin from 'firebase-admin';
dontenv.config()


let privateKey = {
    type: process.env.TYPE,
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.PRIVATE_KEY_ID,
    private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    auth_uri: process.env.AUTH_URI,
    token_uri: process.env.TOKEN_URI,
    auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
    universe_domain: process.env.UNIVERSE_DOMAIN
}

admin.initializeApp({
    credential: admin.credential.cert(privateKey)
})


function ADMIN() {
    this.VerifyToken = async (token) => {
        try {
            const decodedToken = admin.auth().verifyIdToken(token);
            return decodedToken;
        } catch (err) {
            return { status: false, msg: 'Invaid Access Token' }
        }

    }
    this.getUid = async (token) => {
        try {
            const res = await admin.auth().verifyIdToken(token);
            console.log(res)
            return { status: true, uid: res.uid, email: res.email };
        } catch (err) {
            return { status: false, msg: 'Invaid Access Token' }
        }

    }
    this.deleteUser = async (email) => {
        try {
            let user = await admin.auth().getUserByEmail(email)
            await admin.auth().deleteUser(user.uid)
            return { status: true }
        } catch (err) {
            return err
        }
    }
    // this.ClearSession = async (uid) => {
    //     const res = await admin.auth().revokeRefreshTokens(uid)
    //     return  res 
    // }
    this.getEmailId = async (email) => {
        try {
            let user = await admin.auth().getUserByEmail(email)
            return { status: true, user }
        } catch (err) {
            return err
        }
    }
}



const adminService = new ADMIN()


export default adminService