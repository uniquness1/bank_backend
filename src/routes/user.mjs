import express from "express";
import adminService from "../services/auth.mjs";
import { Firestore } from "../database/db.mjs";
const router = express.Router();

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
