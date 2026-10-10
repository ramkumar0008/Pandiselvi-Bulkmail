const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const Email = require("./models/Email");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;
const SENDER_NAME = process.env.BREVO_SENDER_NAME || "BulkMail";

function normalizeEmails(value) {
  const items = Array.isArray(value) ? value : [value];

  return [...new Set(
    items
      .flatMap((item) => String(item || "").split(/[,;\n\r]+/))
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.get("/", (req, res) => {
  res.json({ message: "BulkMail backend is running" });
});

function healthResponse(req, res) {
  res.json({
    server: "running",
    database: mongoose.connection.readyState === 1
      ? "connected"
      : "disconnected",
    emailService: API_KEY && SENDER_EMAIL
      ? "configured"
      : "not configured",
  });
}

app.get("/health", healthResponse);
app.get("/api/health", healthResponse);

async function sendWithBrevo(recipient, subject, message) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: SENDER_NAME,
        email: SENDER_EMAIL,
      },
      to: [{ email: recipient }],
      subject,
      textContent: message,
    }),
    signal: AbortSignal.timeout(20000),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      result.message || `Brevo returned HTTP ${response.status}`
    );
    error.statusCode = response.status;
    throw error;
  }

  return result.messageId || null;
}

app.post("/sendmail", async (req, res) => {
  let record;

  try {
    const { emailList, subject, msg } = req.body || {};

    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ message: "Subject is required." });
    }

    if (!msg || !String(msg).trim()) {
      return res.status(400).json({ message: "Message is required." });
    }

    if (
      !Array.isArray(emailList) &&
      typeof emailList !== "string"
    ) {
      return res.status(400).json({
        message: "emailList must be an array or a string.",
      });
    }

    const recipients = normalizeEmails(emailList);

    if (!recipients.length) {
      return res.status(400).json({
        message: "Enter at least one recipient email address.",
      });
    }

    if (recipients.length > 100) {
      return res.status(400).json({
        message: "Send no more than 100 recipients per request.",
      });
    }

    const invalidEmails = recipients.filter((email) => !validEmail(email));

    if (invalidEmails.length) {
      return res.status(400).json({
        message: "Invalid email addresses found.",
        invalidEmails,
      });
    }

    // Save the request first, preserving history in MongoDB.
    record = await Email.create({
      subject: String(subject).trim(),
      message: String(msg),
      recipients,
      sentTo: [],
      failedTo: [],
      status: "processing",
    });

    if (!API_KEY || !SENDER_EMAIL) {
      record.failedTo = recipients;
      record.status = "failed";
      await record.save();

      return res.status(503).json({
        message: "Brevo is not configured. Check backend environment variables.",
        historyId: record._id,
        sent: 0,
        failed: recipients.length,
      });
    }

    for (const recipient of recipients) {
      try {
        const messageId = await sendWithBrevo(
          recipient,
          String(subject).trim(),
          String(msg)
        );

        // Brevo accepted the API request; this does not guarantee delivery.
        record.sentTo.push(recipient);
        console.log(`Brevo accepted email for ${recipient}: ${messageId || "accepted"}`);
      } catch (error) {
        record.failedTo.push(recipient);

        // Log the error, never the API key.
        console.error(
          `Brevo failed for ${recipient}:`,
          error.statusCode || error.message
        );
      }

      await record.save();
    }

    if (record.failedTo.length === 0) {
      record.status = "sent";
    } else if (record.sentTo.length > 0) {
      record.status = "partial";
    } else {
      record.status = "failed";
    }

    await record.save();

    return res.status(record.status === "sent" ? 200 : 207).json({
      message: record.status === "sent"
        ? "Brevo accepted all email requests."
        : "Some or all email requests failed. Check failedTo and Render logs.",
      historyId: record._id,
      status: record.status,
      sent: record.sentTo.length,
      failed: record.failedTo.length,
      sentTo: record.sentTo,
      failedTo: record.failedTo,
    });
  } catch (error) {
    console.error("Sendmail error:", error.message);

    if (record) {
      try {
        record.status = "failed";
        await record.save();
      } catch (saveError) {
        console.error("History update failed:", saveError.message);
      }
    }

    return res.status(500).json({
      message: "Unable to process the email request.",
      historyId: record?._id,
    });
  }
});

app.get("/history", async (req, res) => {
  try {
    const records = await Email.find()
      .sort({ createdAt: -1 })
      .limit(100);

    return res.json(records);
  } catch (error) {
    console.error("History error:", error.message);
    return res.status(500).json({
      message: "Unable to retrieve email history.",
    });
  }
});

async function startServer() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing from backend environment variables.");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected successfully");

  app.listen(PORT, () => {
    console.log(`BulkMail server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});
