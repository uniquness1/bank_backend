import { Firestore } from "../database/db.mjs";

const VAT_RATE = 0.1075; // 10.75%
const NIBSS_AMOUNT = 50; // 50 naira
const TAX_THRESHOLD = 10000; // 10,000 naira
const FREE_TRANSACTIONS_PER_DAY = 5;

class TaxService {
  constructor() {
    this.cache = new Map();
  }

  // Get daily transaction count for a user
  async getDailyTransactionCount(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const transactions = await Firestore.getAllQueryDoc(
      "TRANSACTIONS",
      "userId",
      userId
    );

    const todayTransactions = transactions.filter((tx) => {
      const txDate = tx.paidAt ? new Date(tx.paidAt) : new Date(tx.createdAt);
      return txDate >= today && txDate < tomorrow && tx.mode === "DEBIT";
    });

    return todayTransactions.length;
  }

  // Calculate taxes for a transaction
  calculateTaxes(amount, dailyTransactionCount) {
    const vatAmount =
      dailyTransactionCount >= FREE_TRANSACTIONS_PER_DAY
        ? amount * VAT_RATE
        : 0;
    const nibssAmount = amount >= TAX_THRESHOLD ? NIBSS_AMOUNT : 0;
    const totalTax = vatAmount + nibssAmount;
    const isTaxed = totalTax > 0;

    return {
      vatAmount: Math.round(vatAmount * 100) / 100, // Round to 2 decimal places
      nibssAmount,
      totalTax,
      isTaxed,
      freeTransactionsLeft: Math.max(
        0,
        FREE_TRANSACTIONS_PER_DAY - dailyTransactionCount
      ),
    };
  }

  // Get free transactions left for the day
  async getFreeTransactionsLeft(userId) {
    const dailyCount = await this.getDailyTransactionCount(userId);
    return Math.max(0, FREE_TRANSACTIONS_PER_DAY - dailyCount);
  }

  // Check if transaction should be taxed
  shouldTaxTransaction(amount, dailyTransactionCount) {
    return (
      amount >= TAX_THRESHOLD ||
      dailyTransactionCount >= FREE_TRANSACTIONS_PER_DAY
    );
  }
}

export default new TaxService();
