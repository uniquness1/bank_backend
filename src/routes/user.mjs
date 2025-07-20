import express from "express";
import adminService from "../services/auth.mjs";
import { Firestore } from "../database/db.mjs";
import { body, validationResult } from 'express-validator'
const router = express.Router();

const validateUpdateProfile = [
  body('firstName').optional().trim().notEmpty().withMessage('First name is required'),
  body('lastName').optional().trim().notEmpty().withMessage('Last name is required'),
  body('userName').optional().trim().notEmpty().withMessage('Username is required'),
  body('phone').optional().matches(/^\d{10,15}$/).withMessage('Invalid phone number'),
]

router.get("/profile", async (req, res) => {
  try {
    let token = req.headers.authorization;
    let userCred = await adminService.getUid(token);
    if (!userCred.uid) {
      throw { message: "Token invalid" };
    }
    const userDataRes = await Firestore.getSingleDoc("USERS", userCred.uid);
    const userData = userDataRes.data();
    res.status(200).json(userData);
  } catch (err) {
    res.status(500).json({ message: "internal server error", status: false });
  }
});

router.put('/profile', validateUpdateProfile, async (req, res) => {
  try {
    let token = req.headers.authorization;
    let userCred = await adminService.getUid(token);
    if (!userCred.uid) {
      return res.status(401).json({ error: 'Token invalid' });
    }
    const userDataRes = await Firestore.getSingleDoc('USERS', userCred.uid);
    if (!userDataRes.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userDataRes.data();
    const updates = {};
    const { firstName, lastName, userName, phone } = req.body;
    if (firstName) updates.firstName = firstName;
    if (lastName) updates.lastName = lastName;
    if (userName) updates.userName = userName;
    if (phone) updates.phone = phone;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    updates.updatedAt = new Date();
    await Firestore.updateDocument('USERS', userCred.uid, updates);
    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update profile' });
  }
});

router.get("/account/:id", async (req, res) => {
  try {
    let accountId = req.params.id;
    let token = req.headers.authorization;
    let userCred = await adminService.getUid(token);
    if (!userCred.uid) {
      throw { message: "Token invalid" };
    }
    const userDataRes = await Firestore.getSingleDoc("USERS", userCred.uid);
    const userData = userDataRes.data();

    if (accountId !== userData.accountId) {
      throw { message: "Account Id doesnt match authenticated userid id!!" };
    }
    const userAccountRes = await Firestore.getSingleDoc("ACCOUNTS", accountId);
    const userAccount = userAccountRes.data();
    res.status(200).json(userAccount);
  } catch (err) {
    res
      .status(500)
      .json({ message: err.message || "internal server error", status: false });
  }
});

router.post("/confirm-account", async (req, res) => {
  try {
    const { accountNumber } = req.body;
    let token = req.headers.authorization;
    if (!accountNumber) {
      throw { message: "Account number is required" };
    }
    let userCred = await adminService.getUid(token);
    if (!userCred.uid) {
      throw { message: "Token invalid" };
    }
    const accountsQuery = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "accountNumber",
      accountNumber,
      "asc"
    );
    if (!accountsQuery.length) {
      throw { message: "Account number not found" };
    }
    res.status(200).json({
      message: "Account confirmed",
      account: {
        accountNumber: accountData.accountNumber,
        accountName: accountData.accountName,
      },
      status: true,
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: err.message || "internal server error", status: false });
  }
});

export default router;
