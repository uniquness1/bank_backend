import { v4 as uuidv4 } from "uuid";

class Savings {
  constructor({
    id = uuidv4(),
    userId,
    name,
    targetAmount = 0,
    balance = 0,
    status = "active",
    createdAt = new Date(),
    updatedAt = new Date(),
    autoChargeEnabled = false,
    autoChargeAmount = 0,
    autoChargeInterval = 0,
    lastAutoCharge = null,
    nextAutoCharge = null,
  }) {
    this.id = id;
    this.userId = userId;
    this.name = name;
    this.targetAmount = targetAmount;
    this.balance = balance;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.autoChargeEnabled = autoChargeEnabled;
    this.autoChargeAmount = autoChargeAmount;
    this.autoChargeInterval = autoChargeInterval;
    this.lastAutoCharge = lastAutoCharge;
    this.nextAutoCharge = nextAutoCharge;
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      name: this.name,
      targetAmount: this.targetAmount,
      balance: this.balance,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      autoChargeEnabled: this.autoChargeEnabled,
      autoChargeAmount: this.autoChargeAmount,
      autoChargeInterval: this.autoChargeInterval,
      lastAutoCharge: this.lastAutoCharge,
      nextAutoCharge: this.nextAutoCharge,
    };
  }

  // Check if savings goal is completed
  isCompleted() {
    return this.balance >= this.targetAmount;
  }

  // Calculate progress percentage
  getProgressPercentage() {
    if (this.targetAmount === 0) return 0;
    return Math.min((this.balance / this.targetAmount) * 100, 100);
  }

  // Set up auto charge
  setupAutoCharge(amount, intervalMinutes) {
    this.autoChargeEnabled = true;
    this.autoChargeAmount = amount;
    this.autoChargeInterval = intervalMinutes;
    this.lastAutoCharge = new Date();
    this.nextAutoCharge = new Date(Date.now() + intervalMinutes * 60 * 1000);
    this.updatedAt = new Date();
  }

  // Disable auto charge
  disableAutoCharge() {
    this.autoChargeEnabled = false;
    this.autoChargeAmount = 0;
    this.autoChargeInterval = 0;
    this.lastAutoCharge = null;
    this.nextAutoCharge = null;
    this.updatedAt = new Date();
  }

  // Check if auto charge should be triggered
  shouldAutoCharge() {
    if (!this.autoChargeEnabled || this.isCompleted()) {
      return false;
    }
    return this.nextAutoCharge && new Date() >= this.nextAutoCharge;
  }

  // Update auto charge schedule
  updateAutoChargeSchedule() {
    if (this.autoChargeEnabled && !this.isCompleted()) {
      this.lastAutoCharge = new Date();
      this.nextAutoCharge = new Date(
        Date.now() + this.autoChargeInterval * 60 * 1000
      );
      this.updatedAt = new Date();
    }
  }
}

export default Savings;
