import { Firestore } from "../database/db.mjs";
import Savings from "../models/savings.mjs";
import Transaction from "../models/transactions.mjs";

class AutoChargeService {
  constructor() {
    this.isRunning = false;
    this.interval = null;
  }

  // Start the auto charge service
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.interval = setInterval(async () => {
      await this.processAutoCharges();
    }, 60000); // Check every minute

    console.log("Auto charge service started");
  }

  // Stop the auto charge service
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log("Auto charge service stopped");
  }

  // Process all auto charges that are due
  async processAutoCharges() {
    try {
      // Get all active savings with auto charge enabled
      const allSavings = await Firestore.getAllDocuments("SAVINGS");

      for (const savingsDoc of allSavings) {
        const savings = savingsDoc.data();
        const savingsInstance = new Savings(savings);

        // Check if auto charge should be triggered
        if (savingsInstance.shouldAutoCharge()) {
          await this.processAutoCharge(savingsInstance);
        }
      }
    } catch (error) {
      console.error("Error processing auto charges:", error);
    }
  }

  // Process auto charge for a specific savings
  async processAutoCharge(savingsInstance) {
    try {
      // Get main account
      const accounts = await Firestore.getAllQueryDoc(
        "ACCOUNTS",
        "userId",
        savingsInstance.userId
      );
      const mainAccount = accounts.length > 0 ? accounts[0] : null;

      if (!mainAccount) {
        console.log(
          `Main account not found for user ${savingsInstance.userId}`
        );
        return;
      }

      // Check if main account has sufficient balance
      if (mainAccount.balance < savingsInstance.autoChargeAmount) {
        console.log(
          `Insufficient balance for auto charge: ${savingsInstance.name}`
        );
        return;
      }

      // Check if savings goal is completed
      if (savingsInstance.isCompleted()) {
        console.log(`Savings goal completed: ${savingsInstance.name}`);
        savingsInstance.disableAutoCharge();
        await Firestore.updateDocument(
          "SAVINGS",
          savingsInstance.id,
          savingsInstance.toJSON()
        );
        return;
      }

      // Process the auto charge
      const prevMainBal = mainAccount.balance;
      const prevSavingsBal = savingsInstance.balance;

      mainAccount.balance -= savingsInstance.autoChargeAmount;
      savingsInstance.balance += savingsInstance.autoChargeAmount;
      savingsInstance.updateAutoChargeSchedule();

      // Generate reference
      const reference = `AUTO_CHARGE_${savingsInstance.id}_${Date.now()}`;

      // Add transaction: DEBIT from main account
      const mainTx = new Transaction({
        userId: mainAccount.userId,
        senderId: mainAccount.userId,
        senderName: mainAccount.accountName,
        receiverId: savingsInstance.id,
        receiverName: savingsInstance.name,
        amount: savingsInstance.autoChargeAmount,
        mode: "DEBIT",
        description: `Auto charge to savings (${savingsInstance.name})`,
        paidAt: new Date(),
        status: "success",
        prevBal: prevMainBal,
        newBal: mainAccount.balance,
        reference,
      });

      // Add transaction: CREDIT to savings (for reference)
      const savingsTx = new Transaction({
        userId: mainAccount.userId,
        senderId: mainAccount.userId,
        senderName: mainAccount.accountName,
        receiverId: savingsInstance.id,
        receiverName: savingsInstance.name,
        amount: savingsInstance.autoChargeAmount,
        mode: "CREDIT",
        description: `Auto charge to savings (${savingsInstance.name})`,
        paidAt: new Date(),
        status: "success",
        prevBal: prevSavingsBal,
        newBal: savingsInstance.balance,
        reference,
      });

      // Update accounts and add transactions
      await Promise.all([
        Firestore.updateDocument("ACCOUNTS", mainAccount.id, mainAccount),
        Firestore.updateDocument(
          "SAVINGS",
          savingsInstance.id,
          savingsInstance.toJSON()
        ),
        Firestore.addDocWithId("TRANSACTIONS", mainTx.id, mainTx.toJSON()),
        Firestore.addDocWithId(
          "TRANSACTIONS",
          savingsTx.id,
          savingsTx.toJSON()
        ),
      ]);

      console.log(
        `Auto charge processed: ${savingsInstance.name} - ₦${savingsInstance.autoChargeAmount}`
      );

      // Check if goal is completed after this charge
      if (savingsInstance.isCompleted()) {
        savingsInstance.disableAutoCharge();
        await Firestore.updateDocument(
          "SAVINGS",
          savingsInstance.id,
          savingsInstance.toJSON()
        );
        console.log(`Savings goal completed: ${savingsInstance.name}`);
      }
    } catch (error) {
      console.error(
        `Error processing auto charge for ${savingsInstance.name}:`,
        error
      );
    }
  }

  // Manually trigger auto charge processing (for testing)
  async triggerProcessing() {
    await this.processAutoCharges();
  }
}

export default new AutoChargeService();
