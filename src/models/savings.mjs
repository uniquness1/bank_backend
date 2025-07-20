import { v4 as uuidv4 } from "uuid";

class Savings {
  constructor({
    id = uuidv4(),
    userId,
    name,
    targetAmount = 0,
    balance = 0,
    status = "active", // active, completed, closed
    createdAt = new Date(),
    updatedAt = new Date(),
  }) {
    this.id = id;
    this.userId = userId;
    this.name = name;
    this.targetAmount = targetAmount;
    this.balance = balance;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
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
    };
  }
}

export default Savings; 