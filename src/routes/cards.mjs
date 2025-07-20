import express from "express";
import { Firestore } from "../database/db.mjs";
import adminService from "../services/auth.mjs";
import Card from "../models/card.mjs";

const router = express.Router();

const authenticateUser = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Missing token" });
  const userCred = await adminService.getUid(token);
  if (!userCred?.uid) return res.status(401).json({ error: "Invalid token" });
  req.userId = userCred.uid;
  next();
};

function generateCardNumber() {
  // 16-digit card number
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join("");
}
function generateExpiry() {
  // MM/YY, 3 years from now
  const now = new Date();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const year = (now.getFullYear() + 3).toString().slice(-2);
  return `${month}/${year}`;
}
function generateCVV() {
  return Math.floor(100 + Math.random() * 900).toString();
}

// Create/generate card
router.post("/", authenticateUser, async (req, res) => {
  try {
    const { cardType = "virtual" } = req.body;
    const card = new Card({
      userId: req.userId,
      cardType,
      cardNumber: generateCardNumber(),
      expiry: generateExpiry(),
      cvv: generateCVV(),
    });
    await Firestore.addDocWithId("CARDS", card.id, card.toJSON());
    res.status(201).json({ message: "Card created", card: card.toJSON() });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to create card" });
  }
});

// List user cards
router.get("/", authenticateUser, async (req, res) => {
  try {
    const cards = await Firestore.getAllQueryDoc("CARDS", "userId", req.userId);
    // Ensure cardType is always present
    const safeCards = cards.map(card => ({
      ...card,
      cardType: card.cardType || 'virtual',
    }));
    res.status(200).json({ cards: safeCards });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch cards" });
  }
});

// Block card
router.patch("/:id/block", authenticateUser, async (req, res) => {
  try {
    const cardDoc = await Firestore.getSingleDoc("CARDS", req.params.id);
    if (!cardDoc.exists()) return res.status(404).json({ error: "Card not found" });
    const card = cardDoc.data();
    if (card.userId !== req.userId) return res.status(403).json({ error: "Forbidden" });
    card.status = "blocked";
    card.updatedAt = new Date();
    await Firestore.updateDocument("CARDS", card.id, card);
    res.status(200).json({ message: "Card blocked", card });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to block card" });
  }
});

export default router; 