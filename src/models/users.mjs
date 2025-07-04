import { v4 as uuidv4 } from "uuid";

class User {
  constructor({
    id = uuidv4(),
    email,
    accountId = uuidv4(),
    isActive = true,
    createdAt = new Date(),
    isProfileComplete = false,
    firstName = "",
    lastName = "",
    userName = "",
    phone = "",
    role = "user",
  }) {
    if (!email) {
      throw new Error("Required field: email");
    }
    if (
      firstName &&
      lastName &&
      userName &&
      phone &&
      !["user", "admin"].includes(role)
    ) {
      throw new Error("Invalid role");
    }

    this.id = id;
    this.email = email;
    this.accountId = accountId;
    this.isActive = isActive;
    this.createdAt = createdAt;
    this.isProfileComplete = isProfileComplete;
    this.firstName = firstName;
    this.lastName = lastName;
    this.userName = userName;
    this.phone = phone;
    this.role = role;
  }

  toJSON() {
    return {
      id: this.id,
      email: this.email,
      accountId: this.accountId,
      isActive: this.isActive,
      createdAt: this.createdAt,
      isProfileComplete: this.isProfileComplete,
      firstName: this.firstName,
      lastName: this.lastName,
      userName: this.userName,
      phone: this.phone,
      role: this.role,
    };
  }
}

export default User;
