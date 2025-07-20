import express from "express";
import { Auth, Firestore } from "../database/db.mjs";
import User from "../models/users.mjs";
import Accounts from "../models/Accounts.mjs";
import { v4 as uuidv4 } from "uuid";
import { body, validationResult } from "express-validator";
import admin from "firebase-admin";
import bcrypt from "bcrypt";

const router = express.Router();

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res
      .status(401)
      .json({ error: "Unauthorized: Missing or invalid token" });
  }
  const idToken = authHeader;
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

const validateSignup = [
  body("email").isEmail().normalizeEmail().withMessage("Invalid email"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("confirmPassword")
    .notEmpty()
    .withMessage("Confirm password is required")
    .custom((value, { req }) => value === req.body.password)
    .withMessage("Passwords do not match"),
];

router.post("/signup", validateSignup, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { email, password } = req.body;
  let userCredential = null;
  let userData = null;

  try {
    userCredential = await Auth.signup(email, password);
    const user = userCredential.user;
    const userProfileData = {
      id: user.uid,
      email,
      accountId: uuidv4(),
      createdAt: new Date(),
      isProfileComplete: false,
    };
    const userRes = new User(userProfileData);
    userData = userRes.toJSON();
    await Firestore.addDocWithId("USERS", userData.id, userData);
    const token = await user.getIdToken();
    res.status(201).json({
      uid: user.uid,
      email: user.email,
      token,
      message: "Initial signup successful, please complete your profile",
    });
  } catch (error) {
    try {
      if (userCredential && userCredential.user) {
        await userCredential.user.delete();
      }
      if (userData && userData.id) {
        await Firestore.removeDoc("USERS", userData.id);
      }
    } catch (etr) {}
    const errorMessage = mapError(error);
    res.status(400).json({ error: errorMessage });
  }
});

const validateCompleteProfile = [
  body("firstName").trim().notEmpty().withMessage("First name is required"),
  body("lastName").trim().notEmpty().withMessage("Last name is required"),
  body("userName").trim().notEmpty().withMessage("Username is required"),
  body("phone")
    .matches(/^\d{10,15}$/)
    .withMessage("Invalid phone number"),
  body("role").optional().isIn(["user", "admin"]).withMessage("Invalid role"),
];

router.post(
  "/complete-profile",
  [authenticateToken, validateCompleteProfile],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { firstName, lastName, userName, phone, role } = req.body;
    const userId = req.user.uid;
    let accountData = null;
    try {
      const userDocSnapshot = await Firestore.getSingleDoc("USERS", userId);
      if (!userDocSnapshot.exists()) {
        return res.status(404).json({ error: "User not found" });
      }
      const userDoc = userDocSnapshot.data();
      if (userDoc.isProfileComplete) {
        return res.status(400).json({ error: "Profile already completed" });
      }

      const userNameQuery = await Firestore.getAllQueryDoc(
        "USERS",
        "userName",
        userName
      );
      if (userNameQuery && userNameQuery.length > 0) {
        return res.status(400).json({ error: "Username already taken" });
      }
      const phoneQuery = await Firestore.getAllQueryDoc(
        "USERS",
        "phone",
        phone
      );
      if (phoneQuery && phoneQuery.length > 0) {
        return res
          .status(400)
          .json({ error: "Phone number already registered" });
      }

      const updatedUserData = {
        firstName,
        lastName,
        userName,
        phone,
        role: role || "user",
        isProfileComplete: true,
        updatedAt: new Date(),
      };
      await Firestore.updateDocument("USERS", userId, updatedUserData);

      const fullName = `${firstName} ${lastName}`;
      accountData = new Accounts({
        id: userDoc.accountId,
        userId,
        accountName: fullName,
        accountNumber: null,
        balance: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await Firestore.addDocWithId(
        "ACCOUNTS",
        userDoc.accountId,
        accountData.toJSON()
      );

      res.status(200).json({ message: "Profile completed successfully" });
    } catch (error) {
      try {
        if (accountData && accountData.id) {
          await Firestore.removeDoc("ACCOUNTS", accountData.id);
        }
      } catch (etr) {}
      res.status(500).json({ error: "Failed to complete profile" });
    }
  }
);

const validateLogin = [
  body("email").isEmail().normalizeEmail().withMessage("Invalid email"),
  body("password").notEmpty().withMessage("Password is required"),
];

router.post("/login", validateLogin, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { email, password } = req.body;
  try {
    const userCredential = await Auth.login(email, password);
    const user = userCredential.user;
    const token = await user.getIdToken();
    const userDocSnapshot = await Firestore.getSingleDoc("USERS", user.uid);
    const redirectUrl =
      userDocSnapshot.exists() && userDocSnapshot.data().isProfileComplete
        ? "/set-pin"
        : "/complete-profile";
    res.status(200).json({
      uid: user.uid,
      email: user.email,
      token,
      redirectUrl,
      message: "Login successful",
    });
  } catch (error) {
    const errorMessage = mapError(error);
    res.status(400).json({ error: errorMessage });
  }
});

const validateSetPin = [
  body("pin")
    .matches(/^\d{4}$/)
    .withMessage("PIN must be a 4-digit number"),
];
router.post(
  "/set-pin",
  [authenticateToken, validateSetPin],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { pin } = req.body;
    const userId = req.user.uid;

    try {
      const userDocSnapshot = await Firestore.getSingleDoc("USERS", userId);
      if (!userDocSnapshot.exists()) {
        return res.status(404).json({ error: "User not found" });
      }

      const userDoc = userDocSnapshot.data();
      if (!userDoc.isProfileComplete) {
        return res
          .status(400)
          .json({ error: "Please complete your profile first" });
      }
      const accountId = userDoc.accountId;
      if (!accountId) {
        return res.status(404).json({ error: "Account ID not found for user" });
      }

      const accountDocSnapshot = await Firestore.getSingleDoc(
        "ACCOUNTS",
        accountId
      );
      if (!accountDocSnapshot.exists()) {
        return res.status(404).json({ error: "Account not found" });
      }
      const hashedPin = bcrypt.hashSync(pin, 10);
      await Firestore.updateDocument("ACCOUNTS", accountId, {
        pin: hashedPin,
        isActive: true,
        updatedAt: new Date(),
      });

      res.status(200).json({ message: "PIN set successfully" });
    } catch (error) {
      res.status(500).json({ error: "Failed to set PIN" });
    }
  }
);
router.post("/generate-account-number", authenticateToken, async (req, res) => {
  const userId = req.user.uid;
  try {
    const userDocSnapshot = await Firestore.getSingleDoc("USERS", userId);
    if (!userDocSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const userDoc = userDocSnapshot.data();
    const accountId = userDoc.accountId;
    if (!accountId) {
      return res.status(404).json({ error: "Account ID not found for user" });
    }
    const accountDocSnapshot = await Firestore.getSingleDoc(
      "ACCOUNTS",
      accountId
    );
    if (!accountDocSnapshot.exists()) {
      return res.status(404).json({ error: "Account not found" });
    }
    const accountData = accountDocSnapshot.data();
    if (accountData.accountNumber) {
      return res
        .status(400)
        .json({ error: "Account number already generated" });
    }
    let accountNumber;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;
    while (!isUnique && attempts < maxAttempts) {
      accountNumber = generateAccountNumber();
      const accountNumberQuery = await Firestore.getAllQueryDoc(
        "ACCOUNTS",
        "accountNumber",
        accountNumber
      );
      if (!accountNumberQuery || accountNumberQuery.length === 0) {
        isUnique = true;
      }
      attempts++;
    }
    if (!isUnique) {
      return res
        .status(500)
        .json({ error: "Failed to generate unique account number" });
    }
    await Firestore.updateDocument("ACCOUNTS", accountId, {
      accountNumber,
      updatedAt: new Date(),
    });
    res.status(200).json({
      message: "Account number generated successfully",
      accountNumber,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate account number" });
  }
});

const validateChangePin = [
  body('oldPin').matches(/^\d{4}$/).withMessage('Old PIN must be a 4-digit number'),
  body('newPin').matches(/^\d{4}$/).withMessage('New PIN must be a 4-digit number'),
]

router.post(
  '/change-pin',
  [authenticateToken, validateChangePin],
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }
    const { oldPin, newPin } = req.body
    const userId = req.user.uid
    try {
      const userDocSnapshot = await Firestore.getSingleDoc('USERS', userId)
      if (!userDocSnapshot.exists()) {
        return res.status(404).json({ error: 'User not found' })
      }
      const userDoc = userDocSnapshot.data()
      const accountId = userDoc.accountId
      if (!accountId) {
        return res.status(404).json({ error: 'Account ID not found for user' })
      }
      const accountDocSnapshot = await Firestore.getSingleDoc('ACCOUNTS', accountId)
      if (!accountDocSnapshot.exists()) {
        return res.status(404).json({ error: 'Account not found' })
      }
      const accountData = accountDocSnapshot.data()
      if (!accountData.pin) {
        return res.status(400).json({ error: 'No PIN set for this account' })
      }
      const isOldPinValid = bcrypt.compareSync(oldPin, accountData.pin)
      if (!isOldPinValid) {
        return res.status(401).json({ error: 'Old PIN is incorrect' })
      }
      const hashedNewPin = bcrypt.hashSync(newPin, 10)
      await Firestore.updateDocument('ACCOUNTS', accountId, {
        pin: hashedNewPin,
        updatedAt: new Date(),
      })
      res.status(200).json({ message: 'PIN changed successfully' })
    } catch (error) {
      res.status(500).json({ error: 'Failed to change PIN' })
    }
  }
)
router.post('/logout', authenticateToken, async (req, res) => {
  const userId = req.user.uid
  try {
    await Auth.logout(userId)
    res.status(200).json({ message: 'Logged out successfully' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to log out' })
  }
})

function generateAccountNumber() {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

function mapError(error) {
  switch (error.code) {
    case "auth/email-already-in-use":
      return "Email is already registered";
    case "auth/invalid-email":
      return "Invalid email format";
    case "auth/weak-password":
      return "Password is too weak";
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Invalid login credentials";
    case "auth/invalid-login-credentials":
      return "Invalid login credentials";
    default:
      return error.message || "An error occurred. Please try again.";
  }
}

export default router;
