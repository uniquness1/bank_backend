import express from "express";
import crypto from "crypto";
import adminService from "../services/auth.mjs";
import { Firestore } from "../database/db.mjs";
import Transaction from "../models/transactions.mjs";
import taxService from "../services/taxService.mjs";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = "https://api.paystack.co";
const MIN_DEPOSIT_AMOUNT = 100;
const MIN_TRANSFER_AMOUNT = 100;
const NIBSS_PUBLIC_KEY = process.env.NIBSSPUBLIC_KEY;

const validateAmount = (
  amount,
  minAmount = MIN_DEPOSIT_AMOUNT,
  operation = "operation"
) => {
  if (isNaN(amount) || !isFinite(amount)) {
    throw { message: "Invalid amount format", code: 400 };
  }
  const numAmount = Number(amount);
  if (numAmount < minAmount) {
    throw {
      message: `Minimum ${operation} amount is ₦${minAmount}`,
      code: 400,
    };
  }
  return numAmount;
};

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

const getUserAccount = async (userId) => {
  const response = await Firestore.getAllQueryDoc("ACCOUNTS", "userId", userId);
  const userAccount = response.length > 0 ? response[0] : null;

  if (!userAccount?.id) {
    throw { message: "User account not found", code: 404 };
  }

  return userAccount;
};

const paystackRequest = async (endpoint, method = "GET", data = null) => {
  const url = `${PAYSTACK_BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
  };

  if (data && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url, options);
  const result = await response.json();

  if (!response.ok) {
    throw {
      message: result.message || "Paystack API error",
      code: response.status,
    };
  }

  return result;
};

// Find account by account number
router.get("/find/:accountNo", async (req, res) => {
  try {
    const accountNo = req.params.accountNo;
    const token = req.headers.authorization;
    await authenticateUser(token);

    const response = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "accountNumber",
      accountNo
    );

    const userWallet = response.length > 0 ? response[0] : {};
    if (!userWallet.id) {
      throw { message: "Account not found", code: 404 };
    }

    res.status(200).json({
      data: {
        name: userWallet.accountName,
        accountNumber: userWallet.accountNumber,
      },
    });
  } catch (err) {
    console.error("Error finding account:", err);
    res.status(err.code || 500).json({
      message: err.message || "Internal server error",
      status: false,
    });
  }
});
router.get("/wallet/:accountNo", async (req, res) => {
  try {
    const accountNo = req.params.accountNo;
    const token = req.headers.authorization;
    if (token !== NIBSS_PUBLIC_KEY) {
      throw { message: "Unauthorized access", code: 401 };
    }
    const response = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "accountNumber",
      accountNo
    );
    const userWallet = response.length > 0 ? response[0] : {};
    if (!userWallet.id) {
      throw { message: "Account not found", code: 404 };
    }
    res.status(200).json({
      data: {
        accountName: userWallet.accountName,
        accountNumber: userWallet.accountNumber,
      },
    });
  } catch (err) {
    console.error("Error finding account:", err);
    res.status(err.code || 500).json({
      message: err.message || "Internal server error",
      status: false,
    });
  }
});
//  TRANSFER ROUTES

router.post("/transfer/:accountNumber/:amount", async (req, res) => {
  try {
    const accountNumber = req.params.accountNumber;
    const amount = validateAmount(
      req.params.amount,
      MIN_TRANSFER_AMOUNT,
      "transfer"
    );
    const token = req.headers.authorization;
    const userCred = await authenticateUser(token);
    const receiverResponse = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "accountNumber",
      accountNumber
    );

    const receiverWallet =
      receiverResponse.length > 0 ? receiverResponse[0] : {};
    if (!receiverWallet.id) {
      throw { message: "Recipient account not found", code: 404 };
    }
    const senderResponse = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "userId",
      userCred.uid
    );
    const senderWallet = senderResponse.length > 0 ? senderResponse[0] : {};
    if (!senderWallet.id) {
      throw { message: "You don't have an active account", code: 404 };
    }
    const { pin } = req.body;
    if (!pin || typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      throw {
        message: "A valid 4-digit PIN is required for transfer",
        code: 400,
      };
    }
    const Accounts = (await import("../models/Accounts.mjs")).default;
    const senderAccountInstance = new Accounts(senderWallet);
    if (!senderAccountInstance.isPinValid(pin)) {
      throw { message: "Invalid PIN. Please try again.", code: 401 };
    }

    if (senderWallet.accountNumber === accountNumber) {
      throw { message: "You can't transfer to yourself", code: 400 };
    }
    // Calculate taxes
    const dailyTransactionCount = await taxService.getDailyTransactionCount(
      userCred.uid
    );
    const taxCalculation = taxService.calculateTaxes(
      amount,
      dailyTransactionCount
    );
    const totalAmountWithTax = amount + taxCalculation.totalTax;

    if (senderWallet.balance < totalAmountWithTax) {
      throw { message: "Insufficient funds", code: 400 };
    }

    const senderPrevBal = senderWallet.balance;
    const senderNewBal = senderWallet.balance - totalAmountWithTax;
    const receiverPrevBal = receiverWallet.balance;
    const receiverNewBal = receiverWallet.balance + amount; // Receiver gets original amount
    senderWallet.balance = senderNewBal;

    const senderTransaction = new Transaction({
      userId: senderWallet.userId,
      senderId: senderWallet.userId,
      senderName: senderWallet.accountName,
      receiverId: receiverWallet.userId,
      receiverName: receiverWallet.accountName,
      amount: amount,
      mode: "DEBIT",
      description: req.body?.description || "Transfer",
      paidAt: new Date(),
      status: "success",
      prevBal: senderPrevBal,
      newBal: senderNewBal,
      vatAmount: taxCalculation.vatAmount,
      nibssAmount: taxCalculation.nibssAmount,
      isTaxed: taxCalculation.isTaxed,
    });

    const receiverTransaction = new Transaction({
      userId: receiverWallet.userId,
      senderId: senderWallet.userId,
      senderName: senderWallet.accountName,
      receiverId: receiverWallet.userId,
      receiverName: receiverWallet.accountName,
      amount: amount,
      mode: "CREDIT",
      description: req.body?.description || "Transfer",
      paidAt: new Date(),
      status: "success",
      prevBal: receiverPrevBal,
      newBal: receiverNewBal,
    });

    receiverWallet.balance = receiverNewBal;
    const senderTransactionJson = senderTransaction.toJSON();
    const receiverTransactionJson = receiverTransaction.toJSON();

    await Promise.all([
      Firestore.updateDocument("ACCOUNTS", senderWallet.id, senderWallet),
      Firestore.updateDocument("ACCOUNTS", receiverWallet.id, receiverWallet),
      Firestore.addDocWithId(
        "TRANSACTIONS",
        senderTransactionJson.id,
        senderTransactionJson
      ),
      Firestore.addDocWithId(
        "TRANSACTIONS",
        receiverTransactionJson.id,
        receiverTransactionJson
      ),
    ]);

    // Increment transaction count and get updated free transactions count
    await taxService.incrementTransactionCount(userCred.uid);
    const updatedFreeTransactionsLeft =
      await taxService.getFreeTransactionsLeft(userCred.uid);

    res.status(200).json({
      data: {
        message: "Money sent successfully",
        freeTransactionsLeft: updatedFreeTransactionsLeft,
      },
      status: true,
    });
  } catch (err) {
    console.error("Error processing transfer:", err);
    res.status(err.code || 500).json({
      message: err.message || "Internal server error",
      status: false,
    });
  }
});

// DEPOSIT ROUTES
// deposit payment link
router.post("/deposit/create-link", async (req, res) => {
  try {
    const { amount, description = "Account Deposit" } = req.body;
    const token = req.headers.authorization;
    const depositAmount = validateAmount(amount, MIN_DEPOSIT_AMOUNT, "deposit");
    const userCred = await authenticateUser(token);
    const userAccount = await getUserAccount(userCred.uid);
    const userDataRes = await Firestore.getSingleDoc("USERS", userCred.uid);
    const userData = userDataRes.data();
    if (!userData?.email) {
      throw { message: "User email not found", code: 404 };
    }
    console.log(userCred);
    const paystackData = {
      email: userData.email,
      amount: depositAmount * 100, // Convert to kobo
      currency: "NGN",
      reference: `DEP_${userAccount.accountNumber}_${Date.now()}`,
      callback_url: `${process.env.FRONTEND_URL}/deposit/success`,
      metadata: {
        userId: userCred.uid,
        accountId: userAccount.id,
        accountNumber: userAccount.accountNumber,
        depositAmount: depositAmount,
        description: description,
        type: "deposit",
      },
    };

    const paystackResponse = await paystackRequest(
      "/transaction/initialize",
      "POST",
      paystackData
    );

    // Create pending transaction
    const pendingTransaction = new Transaction({
      userId: userCred.uid,
      senderId: null,
      senderName: null,
      receiverId: userCred.uid,
      receiverName: userAccount.accountName,
      amount: depositAmount,
      mode: "CREDIT",
      description: description,
      paidAt: null,
      status: "pending",
      prevBal: userAccount.balance,
      newBal: userAccount.balance + depositAmount,
      reference: paystackData.reference,
      paymentGateway: "paystack",
    });

    const transactionJson = pendingTransaction.toJSON();
    await Firestore.addDocWithId(
      "TRANSACTIONS",
      transactionJson.id,
      transactionJson
    );

    res.status(200).json({
      data: {
        paymentUrl: paystackResponse.data.authorization_url,
        reference: paystackData.reference,
        amount: depositAmount,
        accessCode: paystackResponse.data.access_code,
        transactionId: transactionJson.id,
      },
      status: true,
      message: "Deposit link created successfully",
    });
  } catch (err) {
    console.error("Error creating deposit link:", err);
    res.status(err.code || 500).json({
      message: err.message || "Internal server error",
      status: false,
    });
  }
});
router.post(
  "/deposit/paystack-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const rawBody = JSON.stringify(req.body);
      const hash = crypto
        .createHmac("sha512", PAYSTACK_SECRET_KEY)
        .update(rawBody)
        .digest("hex");
      const signature = req.headers["x-paystack-signature"];
      if (hash !== signature) {
        console.error("Invalid webhook signature");
        return res.status(400).json({ message: "Invalid signature" });
      }
      const event = JSON.parse(rawBody);
      console.log("Paystack webhook event:", event.event);

      switch (event.event) {
        case "charge.success":
          await handleSuccessfulDeposit(event.data);
          break;
        case "charge.failed":
          await handleFailedDeposit(event.data);
          break;
        default:
          console.log(`Unhandled event type: ${event.event}`);
      }

      res.status(200).json({ message: "Webhook processed successfully" });
    } catch (err) {
      console.error("Webhook processing error:", err);
      res.status(500).json({ message: "Webhook processing failed" });
    }
  }
);

// Get free transactions left for the day
router.get("/free-transactions-left", async (req, res) => {
  try {
    const token = req.headers.authorization;
    const userCred = await authenticateUser(token);
    const freeTransactionsLeft = await taxService.getFreeTransactionsLeft(
      userCred.uid
    );

    res.status(200).json({
      data: { freeTransactionsLeft },
      status: true,
    });
  } catch (err) {
    console.error("Error fetching free transactions left:", err);
    res.status(err.code || 500).json({
      message: err.message || "Internal server error",
      status: false,
    });
  }
});

// deposit history
router.get("/transactions", async (req, res) => {
  try {
    const token = req.headers.authorization;
    const { page = 1, limit = 20, from, to, type } = req.query;
    const userCred = await authenticateUser(token);

    let allTransactions = await Firestore.getAllQueryDoc(
      "TRANSACTIONS",
      "userId",
      userCred.uid
    );

    if (type && (type === "CREDIT" || type === "DEBIT")) {
      allTransactions = allTransactions.filter((tx) => tx.mode === type);
    }

    const convertToDate = (timestamp) => {
      if (!timestamp) return new Date(0);
      if (timestamp instanceof Date) {
        return timestamp;
      }
      if (timestamp.seconds !== undefined) {
        return new Date(
          timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000
        );
      }
      return new Date(timestamp);
    };

    // Fixed date filtering with proper timezone handling
    if (from) {
      // Parse the date string in the server's timezone (Africa/Lagos)
      const fromDate = new Date(from + "T00:00:00"); // Add time to ensure local timezone
      console.log("From date filter:", fromDate.toString());

      allTransactions = allTransactions.filter((tx) => {
        const txDate = convertToDate(tx.paidAt || tx.createdAt);
        return txDate >= fromDate;
      });
    }

    if (to) {
      // Parse the date string in the server's timezone (Africa/Lagos)
      const toDate = new Date(to + "T23:59:59.999"); // Add time to ensure local timezone
      console.log("To date filter:", toDate.toString());

      allTransactions = allTransactions.filter((tx) => {
        const txDate = convertToDate(tx.paidAt || tx.createdAt);
        return txDate <= toDate;
      });
    }

    const sortedTransactions = allTransactions.sort((a, b) => {
      const dateA = convertToDate(a.paidAt || a.createdAt);
      const dateB = convertToDate(b.paidAt || b.createdAt);
      return dateB - dateA;
    });

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTransactions = sortedTransactions.slice(
      startIndex,
      endIndex
    );

    // Add debug info to see what's happening
    console.log("Total transactions found:", sortedTransactions.length);
    if (sortedTransactions.length > 0) {
      console.log(
        "Latest transaction date:",
        convertToDate(
          sortedTransactions[0].paidAt || sortedTransactions[0].createdAt
        ).toString()
      );
    }

    res.status(200).json({
      transactions: paginatedTransactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(sortedTransactions.length / limit),
        totalTransactions: sortedTransactions.length,
        hasNext: endIndex < sortedTransactions.length,
        hasPrev: startIndex > 0,
      },
      status: true,
    });
  } catch (err) {
    console.error("Error fetching transactions:", err);
    res.status(err.code || 500).json({
      message: err.message || "Internal server error",
      status: false,
    });
  }
});

router.get("/deposit/verify/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    const token = req.headers.authorization;
    await authenticateUser(token);

    const verification = await paystackRequest(
      `/transaction/verify/${reference}`
    );

    res.status(200).json({
      data: verification.data,
      status: true,
    });
  } catch (err) {
    console.error("Error verifying deposit:", err);
    res.status(err.code || 500).json({
      message: err.message || "Internal server error",
      status: false,
    });
  }
});

const handleSuccessfulDeposit = async (paymentData) => {
  try {
    const { reference, metadata, amount, paid_at } = paymentData;
    console.log("[DepositWebhook] Received paymentData:", paymentData);
    if (metadata?.type !== "deposit") {
      console.log("[DepositWebhook] Non-deposit transaction, skipping");
      return;
    }

    const transactionQuery = await Firestore.getAllQueryDoc(
      "TRANSACTIONS",
      "reference",
      reference
    );
    const pendingTransaction =
      transactionQuery.length > 0 ? transactionQuery[0] : null;

    if (!pendingTransaction) {
      console.error(
        `[DepositWebhook] Transaction with reference ${reference} not found`
      );
      return;
    }
    if (pendingTransaction.status !== "pending") {
      console.log(
        `[DepositWebhook] Transaction ${reference} already processed, status: ${pendingTransaction.status}`
      );
      return;
    }
    const depositAmount = amount / 100;
    const userAccount = await getUserAccount(metadata.userId);
    const newBalance = userAccount.balance + depositAmount;

    const updatedTransaction = {
      ...pendingTransaction,
      status: "success",
      paidAt: new Date(paid_at),
      newBal: newBalance,
    };

    const updatedAccount = {
      ...userAccount,
      balance: newBalance,
    };

    await Promise.all([
      Firestore.updateDocument(
        "TRANSACTIONS",
        pendingTransaction.id,
        updatedTransaction
      ),
      Firestore.updateDocument("ACCOUNTS", userAccount.id, updatedAccount),
    ]);

    console.log(
      `[DepositWebhook] Deposit successful: ₦${depositAmount} credited to account ${userAccount.accountNumber}`
    );
  } catch (err) {
    console.error("[DepositWebhook] Error handling successful deposit:", err);
  }
};

const handleFailedDeposit = async (paymentData) => {
  try {
    const { reference, metadata } = paymentData;
    if (metadata?.type !== "deposit") {
      console.log("Non-deposit transaction, skipping");
      return;
    }

    const transactionQuery = await Firestore.getAllQueryDoc(
      "TRANSACTIONS",
      "reference",
      reference
    );
    const pendingTransaction =
      transactionQuery.length > 0 ? transactionQuery[0] : null;

    if (!pendingTransaction) {
      console.error(`Transaction with reference ${reference} not found`);
      return;
    }

    const updatedTransaction = {
      ...pendingTransaction,
      status: "failed",
      paidAt: new Date(),
    };

    await Firestore.updateDocument(
      "TRANSACTIONS",
      pendingTransaction.id,
      updatedTransaction
    );

    console.log(`Deposit failed for reference: ${reference}`);
  } catch (err) {
    console.error("Error handling failed deposit:", err);
  }
};

export default router;
