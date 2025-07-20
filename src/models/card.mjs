import { v4 as uuidv4 } from "uuid";

class Card {
  constructor({
    id = uuidv4(),
    userId,
    cardNumber,
    cardType = "virtual",
    expiry,
    cvv,
    status = "active",
    createdAt = new Date(),
    updatedAt = new Date(),
  }) {
    this.id = id;
    this.userId = userId;
    this.cardNumber = cardNumber;
    this.cardType = cardType;
    this.expiry = expiry;
    this.cvv = cvv;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      cardNumber: this.cardNumber,
      cardType: this.cardType,
      expiry: this.expiry,
      cvv: this.cvv,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export default Card; 