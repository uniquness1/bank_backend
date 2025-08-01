process.env.TZ = "Africa/Lagos";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoute from "./src/routes/auth.mjs";
import userRoute from "./src/routes/user.mjs";
import walletRoute from "./src/routes/wallet.mjs";
import banksRoute from "./src/routes/banks.mjs";
import savingsRouter from "./src/routes/savings.mjs";
import cardsRouter from "./src/routes/cards.mjs";

import authMiddleware from "./src/middlewares/auth.mjs";
import autoChargeService from "./src/services/autoChargeService.mjs";

dotenv.config();

const app = express();
const PORT = process.env.PORT;
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  "/api/deposits/paystack-webhook",
  express.raw({ type: "application/json" })
);
app.use("/auth", authRoute);
app.use("/user", authMiddleware, userRoute);
app.use("/wallet", walletRoute);
app.use("/banks", banksRoute);
app.use("/api/savings", savingsRouter);
app.use("/api/cards", cardsRouter);

app.listen(PORT, async () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
  autoChargeService.start();
});
