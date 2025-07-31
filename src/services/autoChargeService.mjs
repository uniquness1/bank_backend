import { Firestore } from "../database/db.mjs";
import Savings from "../models/savings.mjs";
import Transaction from "../models/transactions.mjs";

class AutoChargeService {
  constructor() {
    this.isRunning = false;
    this.interval = null;
  }
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.interval = setInterval(async () => {
      await this.processAutoCharges();
    }, 60000);
    console.log("Auto charge service started");
  }
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log("Auto charge service stopped");
  }
  async processAutoCharges() {
    try {
      const allSavings = await Firestore.getAllDoc("SAVINGS");

      for (const savingsData of allSavings) {
        const savingsInstance = new Savings(savingsData);
        if (savingsInstance.shouldAutoCharge()) {
          await this.processAutoCharge(savingsInstance);
        }
      }
    } catch (error) {
      console.error("Error processing auto charges:", error);
    }
  }

  async processAutoCharge(savingsInstance) {
    try {
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
      if (mainAccount.balance < savingsInstance.autoChargeAmount) {
        console.log(
          `Insufficient balance for auto charge: ${savingsInstance.name} - Required: ₦${savingsInstance.autoChargeAmount}, Available: ₦${mainAccount.balance}`
        );
        return;
      }
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
      const prevMainBal = mainAccount.balance;
      const prevSavingsBal = savingsInstance.balance;

      mainAccount.balance -= savingsInstance.autoChargeAmount;
      savingsInstance.balance += savingsInstance.autoChargeAmount;
      savingsInstance.updateAutoChargeSchedule();
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
        status: "SUCCESS", // Changed from "success" to "SUCCESS" for consistency
        prevBal: prevMainBal,
        newBal: mainAccount.balance,
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
      ]);

      // Check if goal is completed after this charge
      if (savingsInstance.isCompleted()) {
        savingsInstance.disableAutoCharge();
        await Firestore.updateDocument(
          "SAVINGS",
          savingsInstance.id,
          savingsInstance.toJSON()
        );
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

  // Get service status
  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalId: this.interval,
    };
  }
}

export default new AutoChargeService();
