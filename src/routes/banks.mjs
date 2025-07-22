import express from "express";
import adminService from "../services/auth.mjs";
import { Firestore } from "../database/db.mjs";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

const authenticateUser = async (token) => {
  if (!token) {
    throw { message: "Authorization token is required", code: 401 };
  }
  const userCred = await adminService.getUid(token);
  if (!userCred?.uid) {
    throw { message: "Invalid or expired token", code: 401 };
  }
  return userCred;
};

router.get("/getbanks", async (req, res) => {
  try {
    const token = req.headers.authorization;
    const secretKey = process.env.SECRET_KEY;
    if (!token || !secretKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await authenticateUser(token);

    const bankResponse = await fetch("https://nibss-test.onrender.com/banks", {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: secretKey,
        token,
      },
    });

    if (!bankResponse.ok) {
      throw new Error(`HTTP error! status: ${bankResponse.status}`);
    }

    const bankData = await bankResponse.json();
    return res.status(200).json(bankData);
  } catch (err) {
    console.error("Get banks error:", err);
    const code = err.code === 401 ? 401 : 500;
    return res.status(code).json({
      message: err.message || "Failed to fetch banks",
    });
  }
});

router.post("/validate-account", async (req, res) => {
  try {
    const { accountNumber, bankCode, bankName } = req.body;
    const token = req.headers.authorization;
    const secretKey = process.env.SECRET_KEY;

    if (!token || !secretKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userCred = await authenticateUser(token);

    if (!accountNumber || !bankCode || !bankName) {
      return res.status(400).json({
        message: "Account Number, bank code, and bank name are required",
      });
    }
    const senderResponse = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "userId",
      userCred.uid
    );
    const senderWallet = senderResponse.length > 0 ? senderResponse[0] : {};
    if (
      senderWallet.accountNumber === accountNumber &&
      senderWallet.bankName === bankName
    ) {
      return res.status(400).json({
        error: "You can't transfer to your own account",
      });
    }
    const response = await fetch(
      `https://nibss-test.onrender.com/banks/validate/${accountNumber}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: secretKey,
          token,
        },
        body: JSON.stringify({ bankCode, bankName }),
      }
    );
    if (!response.ok) {
      const errorBody = await response.text();
      const parsedError = JSON.parse(errorBody);
      throw new Error(parsedError.message || "Account validation failed");
    }
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("Validate account error:", err);
    return res.status(500).json({
      message: "Account validation failed",
      error: err.message,
    });
  }
});

router.post("/transfer", async (req, res) => {
  try {
    const token = req.headers.authorization;
    const secretKey = process.env.SECRET_KEY;
    if (!token || !secretKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userCred = await authenticateUser(token);
    const {
      bankCode,
      bankName,
      accountNo,
      accountName,
      amount,
      pin,
      metadata,
      description,
    } = req.body;

    if (
      !bankCode ||
      !bankName ||
      !accountNo ||
      !accountName ||
      !amount ||
      !pin
    ) {
      return res.status(400).json({
        message:
          "Missing required fields: bankCode, bankName, accountNo, accountName, amount, pin",
      });
    }

    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ message: "Invalid PIN format" });
    }
    const senderResponse = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "userId",
      userCred.uid
    );
    const senderWallet = senderResponse.length > 0 ? senderResponse[0] : {};
    if (!senderWallet.id) {
      return res
        .status(404)
        .json({ message: "You don't have an active account" });
    }
    if (!senderWallet.pin) {
      return res.status(400).json({ message: "No PIN set for this account" });
    }
    const Accounts = (await import("../models/Accounts.mjs")).default;
    const senderAccountInstance = new Accounts(senderWallet);
    if (!senderAccountInstance.isPinValid(pin)) {
      return res.status(401).json({ message: "Invalid PIN" });
    }
    if (senderWallet.balance < amount) {
      return res.status(400).json({ message: "Insufficient funds" });
    }
    const transferPayload = {
      bankCode,
      bankName,
      accountNo,
      accountName,
      amount,
      metadata: metadata || {},
    };

    const response = await fetch(
      "https://nibss-test.onrender.com/banks/transfer",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: secretKey,
          token,
        },
        body: JSON.stringify(transferPayload),
      }
    );
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `HTTP error! status: ${response.status}, body: ${errorBody}`
      );
    }
    const result = await response.json();
    return res.status(200).json({
      message: "Transfer successful",
      data: result,
      status: true,
    });
  } catch (err) {
    console.error("Transfer failed:", err);
    return res.status(err.code || 500).json({
      message: err.message || "Transfer failed",
      status: false,
    });
  }
});
router.post("/nibss-webhook", async (req, res) => {
  try {
    const authorization = req.headers.authorization;
    const NIBSS_PUBLIC_KEY = process.env.NIBSSPUBLIC_KEY;
    if (authorization !== NIBSS_PUBLIC_KEY) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }
    res.sendStatus(200);
    if (!req.body || !req.body.event) {
      return res.status(400).json({
        success: false,
        message: "Invalid request body",
      });
    }
    const { event, data } = req.body;
    switch (event) {
      case "transfer.debit.success":
        await handleDebitSuccess(data);
        break;

      case "transfer.credit.success":
        await handleCreditSuccess(data);
        break;
      default:
        console.log(`Unhandled event type: ${event}`);
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
  }
});
async function handleDebitSuccess(data) {
  try {
    console.log("Processing debit success:", data);
    if (!data || !data.metadata || !data.metadata.senderAccount) {
      throw new Error(
        "Missing required data: metadata.accountNumber is required"
      );
    }
    if (!data.amount) {
      throw new Error("Missing required data: amount is required");
    }
    let datam = data.metadata;
    const accountNumber = datam.senderAccount;
    if (!accountNumber) {
      throw new Error("Account number is required but not provided");
    }
    const accountQuery = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "accountNumber",
      accountNumber
    );
    const account = accountQuery.length > 0 ? accountQuery[0] : null;
    if (!account) {
      throw new Error(`Account not found for account number: ${accountNumber}`);
    }
    const prevBal = account.balance;
    const amount = Number(data.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new Error("Invalid amount: must be a positive number");
    }
    const newBal = prevBal - amount;
    if (newBal < 0) {
      throw new Error("Insufficient funds for debit");
    }
    await Firestore.updateDocument("ACCOUNTS", account.id, {
      balance: newBal,
    });
    const Transaction = (await import("../models/transactions.mjs")).default;
    const tx = new Transaction({
      userId: account.userId,
      senderId: account.userId,
      senderName: data.metadata?.senderName || data.bankName || "",
      receiverId: null,
      receiverName: data.accountName,
      amount,
      mode: "DEBIT",
      description: data.metadata?.purpose || "Debit via NIBSS",
      paidAt: new Date(),
      status: "success",
      prevBal,
      newBal,
      reference: `DEP-${Date.now()}-${Math.random(Math.floor) * 100000000}`,
    });
    await Firestore.addDocWithId("TRANSACTIONS", tx.id, tx.toJSON());
    console.log(`Debit processed successfully for account ${accountNumber}`);
  } catch (error) {
    console.error("Error processing debit success:", error);
    throw error;
  }
}
async function handleCreditSuccess(data) {
  try {
    console.log("Processing credit success:", data);
    const accountQuery = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "accountNumber",
      data.accountNumber
    );
    const account = accountQuery.length > 0 ? accountQuery[0] : null;
    if (!account) throw new Error("Account not found");
    const prevBal = account.balance;
    const amount = Number(data.amount);
    const newBal = prevBal + amount;
    await Firestore.updateDocument("ACCOUNTS", account.id, {
      ...account,
      balance: newBal,
      updatedAt: new Date(),
    });
    const Transaction = (await import("../models/transactions.mjs")).default;
    const tx = new Transaction({
      userId: account.userId,
      senderId: data.metadata?.senderAccount || "",
      senderName: data.metadata?.senderName || data.bankName || "",
      receiverId: account.userId,
      receiverName: data.accountName,
      amount,
      mode: "CREDIT",
      description: data.metadata?.description || "NIBSS Credit",
      paidAt: new Date(),
      status: "success",
      prevBal,
      newBal,
      reference: `DEP-${Date.now()}-${Math.random(Math.floor) * 100000000}`,
    });
    await Firestore.addDocWithId("TRANSACTIONS", tx.id, tx.toJSON());
  } catch (error) {
    console.error("Error processing credit success:", error);
    throw error;
  }
}

export default router;
