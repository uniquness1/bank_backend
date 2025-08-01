// taxService.mjs
import { Firestore } from "../database/db.mjs";

const VAT_RATE = 0.1075;
const NIBSS_AMOUNT = 50;
const TAX_THRESHOLD = 10000;
const FREE_TRANSACTIONS_PER_DAY = 5;

class TaxService {
  constructor() {
    this.cache = new Map();
    this.cacheTimestamps = new Map();
  }

  async getDailyTransactionCount(userId) {
    console.log(
      `[TaxService] Getting daily transaction count for user: ${userId}`
    );
    const cacheKey = `${userId}_daily_count`;
    const cachedCount = this.cache.get(cacheKey);
    const cacheTimestamp = this.cacheTimestamps.get(cacheKey);

    // Check cache validity
    if (cachedCount !== undefined && cacheTimestamp) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cacheDate = new Date(cacheTimestamp);
      cacheDate.setHours(0, 0, 0, 0);

      if (cacheDate.getTime() === today.getTime()) {
        // console.log(`[TaxService] Using cached count: ${cachedCount}`);
        return cachedCount;
      } else {
        // console.log(`[TaxService] Cache expired for user: ${userId}`);
        this.cache.delete(cacheKey);
        this.cacheTimestamps.delete(cacheKey);
      }
    }

    // Query Firestore
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    try {
      const transactions = await Firestore.getAllQueryDoc(
        "TRANSACTIONS",
        "userId",
        userId
      );

      const todayTransactions = transactions.filter((tx) => {
        const txDate = tx.paidAt
          ? new Date(tx.paidAt)
          : new Date(tx.createdAt || Date.now());
        const isValidDate =
          txDate.getTime() >= today.getTime() &&
          txDate.getTime() < tomorrow.getTime();

        const isDebit = tx.mode === "DEBIT";
        // console.log(
        //   `[TaxService] Transaction check: ID=${tx.id}, Date=${tx}, Mode=${
        //     tx.mode
        //   }, Valid=${isValidDate && isDebit}`
        // );
        return isValidDate && isDebit;
      });

      const count = todayTransactions.length;
      // console.log(
      //   `[TaxService] Found ${count} debit transactions for user ${userId} today`
      // );

      // Update cache
      this.cache.set(cacheKey, count);
      this.cacheTimestamps.set(cacheKey, Date.now());

      return count;
    } catch (err) {
      console.error(
        `[TaxService] Error fetching transaction count for user ${userId}:`,
        err
      );
      return 0; // Fallback to prevent blocking
    }
  }

  calculateTaxes(amount, dailyTransactionCount) {
    // console.log(
    //   `[TaxService] Calculating taxes - Amount: ${amount}, Daily count: ${dailyTransactionCount}`
    // );

    const vatAmount =
      dailyTransactionCount >= FREE_TRANSACTIONS_PER_DAY
        ? amount * VAT_RATE
        : 0;
    // const nibssAmount = amount >= TAX_THRESHOLD ? NIBSS_AMOUNT : 0;
    const nibssAmount = 0;
    const totalTax = vatAmount + nibssAmount;
    const isTaxed = totalTax > 0;

    const result = {
      vatAmount: Math.round(vatAmount * 100) / 100,
      nibssAmount,
      totalTax: Math.round(totalTax * 100) / 100,
      isTaxed,
      freeTransactionsLeft: Math.max(
        0,
        FREE_TRANSACTIONS_PER_DAY - dailyTransactionCount
      ),
    };

    // console.log(`[TaxService] Tax calculation result:`, result);
    return result;
  }

  async getFreeTransactionsLeft(userId) {
    try {
      const dailyCount = await this.getDailyTransactionCount(userId);
      const freeLeft = Math.max(0, FREE_TRANSACTIONS_PER_DAY - dailyCount);
      // console.log(
      //   `[TaxService] User ${userId}: Daily count: ${dailyCount}, Free left: ${freeLeft}`
      // );
      return freeLeft;
    } catch (err) {
      console.error(
        `[TaxService] Error getting free transactions left for user ${userId}:`,
        err
      );
      return FREE_TRANSACTIONS_PER_DAY; // Fallback to max
    }
  }

  async incrementTransactionCount(userId) {
    // console.log(
    //   `[TaxService] Incrementing transaction count for user ${userId}`
    // );

    try {
      const currentCount = await this.getDailyTransactionCount(userId); // Refresh from DB to ensure accuracy
      const newCount = currentCount + 1;

      // Update cache
      const cacheKey = `${userId}_daily_count`;
      this.cache.set(cacheKey, newCount);
      this.cacheTimestamps.set(cacheKey, Date.now());

      // console.log(
      //   `[TaxService] Transaction count updated from ${currentCount} to ${newCount} for user ${userId}`
      // );
      return newCount;
    } catch (err) {
      console.error(
        `[TaxService] Error incrementing transaction count for user ${userId}:`,
        err
      );
      return await this.getDailyTransactionCount(userId); // Return current count on error
    }
  }

  clearCache(userId) {
    const cacheKey = `${userId}_daily_count`;
    this.cache.delete(cacheKey);
    this.cacheTimestamps.delete(cacheKey);
    // console.log(`[TaxService] Cache cleared for user ${userId}`);
  }

  clearAllCache() {
    this.cache.clear();
    this.cacheTimestamps.clear();
    // console.log(`[TaxService] All cache cleared`);
  }

  async refreshCacheFromDatabase(userId) {
    // console.log(
    //   `[TaxService] Refreshing cache from database for user ${userId}`
    // );
    const cacheKey = `${userId}_daily_count`;
    this.cache.delete(cacheKey);
    this.cacheTimestamps.delete(cacheKey);
    return await this.getDailyTransactionCount(userId);
  }
}

export default new TaxService();
