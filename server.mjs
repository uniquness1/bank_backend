import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// routhe imports
import authRoute from "./src/routes/auth.mjs";
import userRoute from "./src/routes/user.mjs";
import walletRoute from "./src/routes/wallet.mjs";

// middleware imports
import authMiddleware from "./src/middlewares/auth.mjs";

dotenv.config();

const app = express();
const PORT = process.env.PORT;
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  "/api/deposits/paystack-webhook",
  express.raw({ type: "application/json" })
);
// routes
app.use("/auth", authRoute);
app.use("/user", authMiddleware, userRoute);
app.use("/wallet", walletRoute);

app.listen(PORT, async () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});
