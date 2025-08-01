import express from "express";
import adminService from "../services/auth.mjs";
import { Firestore } from "../database/db.mjs";
import taxService from "../services/taxService.mjs";
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
    const senderBankName = senderWallet.bankName || "Banka";
    const isSameBankTransfer =
      senderBankName.toLowerCase() === "banka" &&
      bankName.toLowerCase() === "banka";
    const shouldApplyTax = !isSameBankTransfer;
    const dailyTransactionCount = await taxService.getDailyTransactionCount(
      userCred.uid
    );
    let taxCalculation = { vatAmount: 0, nibssAmount: 0, isTaxed: false };
    if (shouldApplyTax) {
      taxCalculation = taxService.calculateTaxes(amount, dailyTransactionCount);
    }
    const transferPayload = {
      bankCode,
      bankName,
      accountNo,
      accountName,
      amount,
      metadata: {
        ...metadata,
        senderUserId: userCred.uid,
        senderAccount: senderWallet.accountNumber,
        senderName: senderWallet.accountName,
        senderAccountId: senderWallet.id,
        senderBankName: senderBankName,
        transferType: "external",
        purpose: metadata?.purpose || description || "External Transfer",
        vatAmount: taxCalculation.vatAmount,
        nibssAmount: taxCalculation.nibssAmount,
        isTaxed: taxCalculation.isTaxed,
        shouldApplyTax: shouldApplyTax,
        isSameBankTransfer: isSameBankTransfer,
        dailyTransactionCount: dailyTransactionCount,
      },
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
    const currentFreeTransactionsLeft =
      await taxService.getFreeTransactionsLeft(userCred.uid);

    return res.status(200).json({
      message: "Transfer initiated successfully",
      data: {
        ...result,
        freeTransactionsLeft: currentFreeTransactionsLeft,
        shouldApplyTax: shouldApplyTax,
        isSameBankTransfer: isSameBankTransfer,
        taxInfo: shouldApplyTax ? taxCalculation : null,
        note: "Transaction will be processed when confirmed by the payment provider",
      },
      status: true,
    });
  } catch (err) {
    console.error("Transfer initiation failed:", err);
    return res.status(500).json({
      message: err.message || "Transfer initiation failed",
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
      console.log("Invalid webhook body:", req.body);
      return res.status(400).json({
        success: false,
        message: "Invalid request body",
      });
    }
    const { event, data } = req.body;
    console.log(`Processing webhook event: ${event}`);
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
    console.log("[Webhook] === PROCESSING DEBIT SUCCESS ===");
    console.log("[Webhook] Webhook data:", JSON.stringify(data, null, 2));

    if (!data || !data.metadata || !data.metadata.senderAccount) {
      throw new Error(
        "Missing required data: metadata.senderAccount is required"
      );
    }

    if (!data.amount) {
      throw new Error("Missing required data: amount is required");
    }

    const metadata = data.metadata;
    const accountNumber = metadata.senderAccount;
    const amount = Number(data.amount);

    if (isNaN(amount) || amount <= 0) {
      throw new Error("Invalid amount: must be a positive number");
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

    const reference =
      data.reference ||
      `TRANSFER_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    // Check for duplicates
    const existingTransactions = await Firestore.getAllQueryDoc(
      "TRANSACTIONS",
      "reference",
      reference
    );
    if (existingTransactions.length > 0) {
      console.log(
        `[Webhook] Transaction with reference ${reference} already exists, skipping`
      );
      return;
    }

    // Additional duplicate check
    const recentTransactions = await Firestore.getAllQueryDoc(
      "TRANSACTIONS",
      "userId",
      account.userId
    );
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const recentDuplicate = recentTransactions.find(
      (tx) =>
        tx.amount === amount &&
        tx.mode === "DEBIT" &&
        tx.status === "success" &&
        new Date(tx.paidAt) > fiveMinutesAgo
    );

    if (recentDuplicate) {
      console.log(
        `[Webhook] Recent duplicate transaction found, skipping processing`
      );
      return;
    }

    // Update account balance
    const prevBal = account.balance;
    const newBal = prevBal - amount;

    if (newBal < 0) {
      throw new Error("Insufficient funds for debit");
    }

    await Firestore.updateDocument("ACCOUNTS", account.id, { balance: newBal });

    // Get tax information
    const isExternalTransfer = metadata.transferType === "external";
    const shouldApplyTax = metadata.shouldApplyTax === true;
    const isSameBankTransfer = metadata.isSameBankTransfer === true;

    console.log(
      `[Webhook] External: ${isExternalTransfer}, Apply tax: ${shouldApplyTax}, Same bank: ${isSameBankTransfer}`
    );

    // Create transaction
    const transactionData = {
      userId: account.userId,
      senderId: account.userId,
      senderName: metadata.senderName || account.accountName,
      receiverId: null,
      receiverName: data.accountName,
      amount,
      mode: "DEBIT",
      description: metadata.purpose || "Transfer",
      paidAt: new Date().toISOString(), // Ensure consistent timestamp
      status: "success",
      prevBal,
      newBal,
      reference,
    };

    if (isExternalTransfer) {
      transactionData.vatAmount = shouldApplyTax ? metadata.vatAmount || 0 : 0;
      transactionData.nibssAmount = shouldApplyTax
        ? metadata.nibssAmount || 0
        : 0;
      transactionData.isTaxed = shouldApplyTax && metadata.isTaxed;
      transactionData.bankCode = data.bankCode;
      transactionData.bankName = data.bankName;
      transactionData.externalTransfer = true;
      transactionData.isSameBankTransfer = isSameBankTransfer;
    }

    const Transaction = (await import("../models/transactions.mjs")).default;
    const tx = new Transaction(transactionData);
    await Firestore.addDocWithId("TRANSACTIONS", tx.id, tx.toJSON());

    console.log(`[Webhook] Transaction created in database with ID: ${tx.id}`);

    // Increment transaction count
    if (metadata.senderUserId) {
      console.log(
        `[Webhook] Incrementing transaction count for user ${metadata.senderUserId}`
      );
      await taxService.incrementTransactionCount(metadata.senderUserId);
      const freeTransactionsLeft = await taxService.getFreeTransactionsLeft(
        metadata.senderUserId
      );
      console.log(
        `[Webhook] Transaction count updated to: ${newCount}, Free left: ${freeTransactionsLeft}`
      );
    }

    console.log(
      `[Webhook] ${
        isExternalTransfer ? "External" : "Internal"
      } debit transaction created successfully`
    );
    console.log(`[Webhook] Account ${accountNumber}: ${prevBal} -> ${newBal}`);
    console.log(
      `[Webhook] Tax applied: ${
        shouldApplyTax ? "Yes" : "No"
      } (Same bank: ${isSameBankTransfer})`
    );
  } catch (error) {
    console.error("[Webhook] Error processing debit success:", error);
    throw error;
  }
}
async function handleCreditSuccess(data) {
  try {
    console.log("=== PROCESSING CREDIT SUCCESS ===");
    console.log("Webhook data:", JSON.stringify(data, null, 2));

    const accountQuery = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "accountNumber",
      data.accountNumber
    );
    const account = accountQuery.length > 0 ? accountQuery[0] : null;

    if (!account) {
      throw new Error("Account not found");
    }

    const amount = Number(data.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new Error("Invalid or missing amount");
    }

    const reference =
      data.reference ||
      `CREDIT_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    // Prevent duplicate credit
    const existingTransactions = await Firestore.getAllQueryDoc(
      "TRANSACTIONS",
      "reference",
      reference
    );
    if (existingTransactions.length > 0) {
      console.log(
        `Credit transaction with reference ${reference} already exists, skipping`
      );
      return;
    }

    const prevBal = account.balance;
    const newBal = prevBal + amount;

    // Update account balance (before NIBSS charge)
    await Firestore.updateDocument("ACCOUNTS", account.id, {
      balance: newBal,
      updatedAt: new Date(),
    });

    const Transaction = (await import("../models/transactions.mjs")).default;

    // Save CREDIT transaction
    const tx = new Transaction({
      userId: account.userId,
      senderId: data.metadata?.senderUserId || null,
      senderName: data.metadata?.senderName || data.bankName || "",
      receiverId: account.userId,
      receiverName: data.accountName,
      amount,
      mode: "CREDIT",
      description: data.metadata?.description || "Incoming Transfer",
      paidAt: new Date(),
      status: "success",
      prevBal,
      newBal,
      reference,
    });
    await Firestore.addDocWithId("TRANSACTIONS", tx.id, tx.toJSON());

    const NIBSS_AMOUNT = 50;
    const TAX_THRESHOLD = 10000;

    if (amount >= TAX_THRESHOLD) {
      const nibssReference = `NIBSS_CHARGE_${Date.now()}_${Math.floor(
        Math.random() * 1000000
      )}`;
      const nibssPrevBal = newBal;
      const nibssNewBal = newBal - NIBSS_AMOUNT;

      const nibssTx = new Transaction({
        userId: account.userId,
        senderId: "SYSTEM",
        senderName: "NIBSS CHARGE",
        receiverId: account.userId,
        receiverName: account.accountName,
        amount: NIBSS_AMOUNT,
        mode: "DEBIT",
        description: "NIBSS Credit Charge",
        paidAt: new Date(),
        status: "success",
        prevBal: nibssPrevBal,
        newBal: nibssNewBal,
        reference: nibssReference,
      });

      // Save NIBSS transaction
      await Firestore.addDocWithId(
        "TRANSACTIONS",
        nibssTx.id,
        nibssTx.toJSON()
      );

      // Update balance again
      await Firestore.updateDocument("ACCOUNTS", account.id, {
        balance: nibssNewBal,
        updatedAt: new Date(),
      });

      console.log(
        `[Webhook] NIBSS ₦${NIBSS_AMOUNT} charge applied successfully.`
      );
      console.log(
        `[Webhook] Account ${account.accountNumber}: ${nibssPrevBal} -> ${nibssNewBal}`
      );
    }

    console.log(
      `[Webhook] CREDIT processed successfully for account ${account.accountNumber}`
    );
  } catch (error) {
    console.error("Error processing credit success:", error);
    throw error;
  }
}

export default router;
