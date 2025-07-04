import bcrypt from "bcrypt";

class Accounts {
  constructor({
    id,
    userId,
    accountName,
    accountNumber = null,
    balance = 0,
    pin,
    bankName = "Banka Bank",
    isActive = false,
    createdAt = new Date(),
    updatedAt = new Date(),
  }) {
    if (!id || !userId || !accountName) {
      throw new Error("Required fields: id, userId, accountName");
    }

    if (accountNumber !== null && !/^\d{10}$/.test(accountNumber)) {
      throw new Error("Account number must be 10 digits");
    }

    if (typeof balance !== "number" || balance < 0) {
      throw new Error("Balance must be a non-negative number");
    }

    this.id = id;
    this.userId = userId;
    this.accountName = accountName;
    this.accountNumber = accountNumber;
    this.balance = balance;
    this.bankName = bankName;
    this.isActive = isActive;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.pin = pin ? bcrypt.hashSync(pin, 10) : null;
  }

  isPinValid(pin) {
    if (!this.pin || !pin) return false;
    return bcrypt.compareSync(pin, this.pin);
  }

  setPin(newPin) {
    if (!/^\d{4}$/.test(newPin)) {
      throw new Error("PIN must be a 4-digit number");
    }
    this.pin = bcrypt.hashSync(newPin, 10);
    this.updatedAt = new Date();
  }

  setAccountNumber(accountNumber) {
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new Error("Account number must be 10 digits");
    }
    this.accountNumber = accountNumber;
    this.updatedAt = new Date();
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      accountName: this.accountName,
      accountNumber: this.accountNumber,
      balance: this.balance,
      pin: this.pin,
      bankName: this.bankName,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export default Accounts;
