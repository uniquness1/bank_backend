import express from "express";
import { Firestore } from "../database/db.mjs";
import adminService from "../services/auth.mjs";
import Savings from "../models/savings.mjs";
import Transaction from "../models/transactions.mjs";

const router = express.Router();

// Middleware to authenticate user
const authenticateUser = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Missing token" });
  const userCred = await adminService.getUid(token);
  if (!userCred?.uid) return res.status(401).json({ error: "Invalid token" });
  req.userId = userCred.uid;
  next();
};

// Create savings
router.post("/", authenticateUser, async (req, res) => {
  try {
    const { name, targetAmount } = req.body;
    if (!name || !targetAmount)
      return res.status(400).json({ error: "Name and target amount required" });
    const savings = new Savings({ userId: req.userId, name, targetAmount });
    await Firestore.addDocWithId("SAVINGS", savings.id, savings.toJSON());
    res.status(201).json({ message: "Savings created", savings });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to create savings" });
  }
});

// Get all savings for user
router.get("/", authenticateUser, async (req, res) => {
  try {
    const savingsList = await Firestore.getAllQueryDoc(
      "SAVINGS",
      "userId",
      req.userId
    );
    res.status(200).json({ savings: savingsList });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch savings" });
  }
});

// Deposit to savings
router.post("/:id/deposit", authenticateUser, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || isNaN(amount) || amount <= 0)
      return res.status(400).json({ error: "Invalid amount" });
    const savingsDoc = await Firestore.getSingleDoc("SAVINGS", req.params.id);
    if (!savingsDoc.exists())
      return res.status(404).json({ error: "Savings not found" });
    const savings = savingsDoc.data();
    if (savings.userId !== req.userId)
      return res.status(403).json({ error: "Forbidden" });
    // Get main account
    const accounts = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "userId",
      req.userId
    );
    const mainAccount = accounts.length > 0 ? accounts[0] : null;
    if (!mainAccount)
      return res.status(404).json({ error: "Main account not found" });
    if (mainAccount.balance < amount)
      return res
        .status(400)
        .json({ error: "Insufficient main account balance" });
    // Deduct from main, add to savings
    const prevMainBal = mainAccount.balance;
    const prevSavingsBal = savings.balance;
    mainAccount.balance -= Number(amount);
    savings.balance += Number(amount);
    savings.updatedAt = new Date();
    await Promise.all([
      Firestore.updateDocument("ACCOUNTS", mainAccount.id, mainAccount),
      Firestore.updateDocument("SAVINGS", savings.id, savings),
    ]);
    // Generate reference
    const reference = `SAVINGS_DEPOSIT_${savings.id}_${Date.now()}`;
    // Add transaction: DEBIT from main account
    // const mainTx = new Transaction({
    //   userId: mainAccount.userId,
    //   senderId: mainAccount.userId,
    //   senderName: mainAccount.accountName,
    //   receiverId: savings.id,
    //   receiverName: savings.name,
    //   amount: Number(amount),
    //   mode: "DEBIT",
    //   description: `Deposit to savings (${savings.name})`,
    //   paidAt: new Date(),
    //   status: "success",
    //   prevBal: prevMainBal,
    //   newBal: mainAccount.balance,
    //   reference,
    // });
    // Add transaction: CREDIT to savings (for reference, not shown in user tx list)
    const savingsTx = new Transaction({
      userId: mainAccount.userId,
      senderId: mainAccount.userId,
      senderName: mainAccount.accountName,
      receiverId: savings.id,
      receiverName: savings.name,
      amount: Number(amount),
      mode: "CREDIT",
      description: `Deposit to savings (${savings.name})`,
      paidAt: new Date(),
      status: "success",
      prevBal: prevSavingsBal,
      newBal: savings.balance,
      reference,
    });
    await Promise.all([
      Firestore.addDocWithId("TRANSACTIONS", mainTx.id, mainTx.toJSON()),
      // Firestore.addDocWithId("TRANSACTIONS", savingsTx.id, savingsTx.toJSON()),
    ]);
    res
      .status(200)
      .json({ message: "Deposit successful", savings, mainAccount });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to deposit" });
  }
});

// Withdraw from savings
router.post("/:id/withdraw", authenticateUser, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || isNaN(amount) || amount <= 0)
      return res.status(400).json({ error: "Invalid amount" });
    const savingsDoc = await Firestore.getSingleDoc("SAVINGS", req.params.id);
    if (!savingsDoc.exists())
      return res.status(404).json({ error: "Savings not found" });
    const savings = savingsDoc.data();
    if (savings.userId !== req.userId)
      return res.status(403).json({ error: "Forbidden" });
    if (savings.balance < amount)
      return res.status(400).json({ error: "Insufficient savings balance" });
    // Get main account
    const accounts = await Firestore.getAllQueryDoc(
      "ACCOUNTS",
      "userId",
      req.userId
    );
    const mainAccount = accounts.length > 0 ? accounts[0] : null;
    if (!mainAccount)
      return res.status(404).json({ error: "Main account not found" });
    // Deduct from savings, add to main
    const prevSavingsBal = savings.balance;
    const prevMainBal = mainAccount.balance;
    savings.balance -= Number(amount);
    mainAccount.balance += Number(amount);
    savings.updatedAt = new Date();
    await Promise.all([
      Firestore.updateDocument("SAVINGS", savings.id, savings),
      Firestore.updateDocument("ACCOUNTS", mainAccount.id, mainAccount),
    ]);
    // Generate reference
    const reference = `SAVINGS_WITHDRAW_${savings.id}_${Date.now()}`;
    // Add transaction: DEBIT from savings (for reference, not shown in user tx list)
    const savingsTx = new Transaction({
      userId: mainAccount.userId,
      senderId: savings.id,
      senderName: savings.name,
      receiverId: mainAccount.userId,
      receiverName: mainAccount.accountName,
      amount: Number(amount),
      mode: "DEBIT",
      description: `Withdraw from savings (${savings.name})`,
      paidAt: new Date(),
      status: "success",
      prevBal: prevSavingsBal,
      newBal: savings.balance,
      reference,
    });
    // Add transaction: CREDIT to main account
    const mainTx = new Transaction({
      userId: mainAccount.userId,
      senderId: savings.id,
      senderName: savings.name,
      receiverId: mainAccount.userId,
      receiverName: mainAccount.accountName,
      amount: Number(amount),
      mode: "CREDIT",
      description: `Withdraw from savings (${savings.name})`,
      paidAt: new Date(),
      status: "success",
      prevBal: prevMainBal,
      newBal: mainAccount.balance,
      reference,
    });
    await Promise.all([
      Firestore.addDocWithId("TRANSACTIONS", savingsTx.id, savingsTx.toJSON()),
      Firestore.addDocWithId("TRANSACTIONS", mainTx.id, mainTx.toJSON()),
    ]);
    res
      .status(200)
      .json({ message: "Withdrawal successful", savings, mainAccount });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to withdraw" });
  }
});

// Setup auto charge for savings
router.post("/:id/auto-charge", authenticateUser, async (req, res) => {
  try {
    const { amount, intervalMinutes } = req.body;
    if (!amount || !intervalMinutes || amount <= 0 || intervalMinutes <= 0) {
      return res
        .status(400)
        .json({ error: "Valid amount and interval required" });
    }

    const savingsDoc = await Firestore.getSingleDoc("SAVINGS", req.params.id);
    if (!savingsDoc.exists())
      return res.status(404).json({ error: "Savings not found" });
    const savings = savingsDoc.data();
    if (savings.userId !== req.userId)
      return res.status(403).json({ error: "Forbidden" });

    // Create savings instance and setup auto charge
    const savingsInstance = new Savings(savings);
    savingsInstance.setupAutoCharge(Number(amount), Number(intervalMinutes));

    await Firestore.updateDocument(
      "SAVINGS",
      savings.id,
      savingsInstance.toJSON()
    );
    res.status(200).json({
      message: "Auto charge setup successful",
      savings: savingsInstance.toJSON(),
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: err.message || "Failed to setup auto charge" });
  }
});

// Disable auto charge
router.delete("/:id/auto-charge", authenticateUser, async (req, res) => {
  try {
    const savingsDoc = await Firestore.getSingleDoc("SAVINGS", req.params.id);
    if (!savingsDoc.exists())
      return res.status(404).json({ error: "Savings not found" });
    const savings = savingsDoc.data();
    if (savings.userId !== req.userId)
      return res.status(403).json({ error: "Forbidden" });

    const savingsInstance = new Savings(savings);
    savingsInstance.disableAutoCharge();

    await Firestore.updateDocument(
      "SAVINGS",
      savings.id,
      savingsInstance.toJSON()
    );
    res.status(200).json({
      message: "Auto charge disabled",
      savings: savingsInstance.toJSON(),
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: err.message || "Failed to disable auto charge" });
  }
});

// Delete savings goal
router.delete("/:id", authenticateUser, async (req, res) => {
  try {
    const savingsDoc = await Firestore.getSingleDoc("SAVINGS", req.params.id);
    if (!savingsDoc.exists())
      return res.status(404).json({ error: "Savings not found" });
    const savings = savingsDoc.data();
    if (savings.userId !== req.userId)
      return res.status(403).json({ error: "Forbidden" });

    // If balance > 0, transfer to main account first
    if (savings.balance > 0) {
      const accounts = await Firestore.getAllQueryDoc(
        "ACCOUNTS",
        "userId",
        req.userId
      );
      const mainAccount = accounts.length > 0 ? accounts[0] : null;
      if (mainAccount) {
        const prevMainBal = mainAccount.balance;
        const prevSavingsBal = savings.balance;
        mainAccount.balance += Number(savings.balance);
        const reference = `SAVINGS_DELETE_${savings.id}_${Date.now()}`;

        // Add transaction: DEBIT from savings (for reference)
        // const savingsTx = new Transaction({
        //   userId: mainAccount.userId,
        //   senderId: savings.id,
        //   senderName: savings.name,
        //   receiverId: mainAccount.userId,
        //   receiverName: mainAccount.accountName,
        //   amount: Number(savings.balance),
        //   mode: "DEBIT",
        //   description: `Delete savings (${savings.name})`,
        //   paidAt: new Date(),
        //   status: "success",
        //   prevBal: prevSavingsBal,
        //   newBal: 0,
        //   reference,
        // });
        const mainTx = new Transaction({
          userId: mainAccount.userId,
          senderId: savings.id,
          senderName: savings.name,
          receiverId: mainAccount.userId,
          receiverName: mainAccount.accountName,
          amount: Number(savings.balance),
          mode: "CREDIT",
          description: `Delete savings (${savings.name})`,
          paidAt: new Date(),
          status: "success",
          prevBal: prevMainBal,
          newBal: mainAccount.balance,
          reference,
        });

        await Promise.all([
          Firestore.updateDocument("ACCOUNTS", mainAccount.id, mainAccount),
          // Firestore.addDocWithId(
          //   "TRANSACTIONS",
          //   savingsTx.id,
          //   savingsTx.toJSON()
          // ),
          Firestore.addDocWithId("TRANSACTIONS", mainTx.id, mainTx.toJSON()),
        ]);
      }
    }

    // Delete the savings document
    await Firestore.removeDoc("SAVINGS", savings.id);
    res.status(200).json({ message: "Savings deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to delete savings" });
  }
});

// Close savings
router.patch("/:id/close", authenticateUser, async (req, res) => {
  try {
    const savingsDoc = await Firestore.getSingleDoc("SAVINGS", req.params.id);
    if (!savingsDoc.exists())
      return res.status(404).json({ error: "Savings not found" });
    const savings = savingsDoc.data();
    if (savings.userId !== req.userId)
      return res.status(403).json({ error: "Forbidden" });
    // If balance > 0, transfer to main account and record transaction
    if (savings.balance > 0) {
      const accounts = await Firestore.getAllQueryDoc(
        "ACCOUNTS",
        "userId",
        req.userId
      );
      const mainAccount = accounts.length > 0 ? accounts[0] : null;
      if (mainAccount) {
        const prevMainBal = mainAccount.balance;
        const prevSavingsBal = savings.balance;
        mainAccount.balance += Number(savings.balance);
        // Generate reference
        const reference = `SAVINGS_CLOSE_${savings.id}_${Date.now()}`;
        // Add transaction: DEBIT from savings (for reference)
        // const savingsTx = new Transaction({
        //   userId: mainAccount.userId,
        //   senderId: savings.id,
        //   senderName: savings.name,
        //   receiverId: mainAccount.userId,
        //   receiverName: mainAccount.accountName,
        //   amount: Number(savings.balance),
        //   mode: "DEBIT",
        //   description: `Close savings (${savings.name})`,
        //   paidAt: new Date(),
        //   status: "success",
        //   prevBal: prevSavingsBal,
        //   newBal: 0,
        //   reference,
        // });
        // Add transaction: CREDIT to main account
        const mainTx = new Transaction({
          userId: mainAccount.userId,
          senderId: savings.id,
          senderName: savings.name,
          receiverId: mainAccount.userId,
          receiverName: mainAccount.accountName,
          amount: Number(savings.balance),
          mode: "CREDIT",
          description: `Close savings (${savings.name})`,
          paidAt: new Date(),
          status: "success",
          prevBal: prevMainBal,
          newBal: mainAccount.balance + Number(savings.balance),
          reference,
        });
        await Promise.all([
          Firestore.updateDocument("ACCOUNTS", mainAccount.id, mainAccount),
          // Firestore.addDocWithId(
          //   "TRANSACTIONS",
          //   savingsTx.id,
          //   savingsTx.toJSON()
          // ),
          Firestore.addDocWithId("TRANSACTIONS", mainTx.id, mainTx.toJSON()),
        ]);
      }
      savings.balance = 0;
    }
    savings.status = "closed";
    savings.updatedAt = new Date();
    await Firestore.updateDocument("SAVINGS", savings.id, savings);
    res.status(200).json({ message: "Savings closed", savings });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to close savings" });
  }
});

export default router;
