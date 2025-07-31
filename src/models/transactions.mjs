import { v4 as uuidv4 } from "uuid";

class Transaction {
  constructor({
    id = uuidv4(),
    userId,
    senderId,
    senderName,
    receiverId,
    receiverName,
    amount,
    mode,
    description,
    paidAt,
    status,
    prevBal,
    newBal,
    createdAt = new Date(),
    reference,
    vatAmount = 0,
    nibssAmount = 0,
    isTaxed = false,
  }) {
    this.id = id;
    this.userId = userId;
    this.senderId = senderId;
    this.senderName = senderName;
    this.receiverId = receiverId;
    this.receiverName = receiverName;
    this.amount = amount;
    this.mode = mode;
    this.description = description;
    this.paidAt = paidAt;
    this.status = status;
    this.prevBal = prevBal;
    this.newBal = newBal;
    this.createdAt = createdAt;
    this.reference = reference;
    this.vatAmount = vatAmount;
    this.nibssAmount = nibssAmount;
    this.isTaxed = isTaxed;
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      senderId: this.senderId,
      senderName: this.senderName,
      receiverId: this.receiverId,
      receiverName: this.receiverName,
      amount: this.amount,
      mode: this.mode,
      description: this.description,
      paidAt: this.paidAt,
      status: this.status,
      prevBal: this.prevBal,
      newBal: this.newBal,
      createdAt: this.createdAt,
      reference: this.reference,
      vatAmount: this.vatAmount,
      nibssAmount: this.nibssAmount,
      isTaxed: this.isTaxed,
    };
  }
}

export default Transaction;
