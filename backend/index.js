const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { google } = require("googleapis");
require("dotenv").config();

const Email = require("./models/Email");

const app = express();
const PORT = process.env.PORT || 5000;

// Gmail environment variables
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const SENDER_EMAIL = process.env.GMAIL_SENDER_EMAIL;

// Basic email validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

let gmail = null;

// --------------------------------------------------
// Configure Gmail API
// --------------------------------------------------
function configureGmail() {
  const missing = [];

  if (!CLIENT_ID) missing.push("GMAIL_CLIENT_ID");
  if (!CLIENT_SECRET) missing.push("GMAIL_CLIENT_SECRET");
  if (!REFRESH_TOKEN) missing.push("GMAIL_REFRESH_TOKEN");
  if (!SENDER_EMAIL) missing.push("GMAIL_SENDER_EMAIL");

  if (missing.length > 0) {
    console.error(
      "Missing Gmail environment variables:",
      missing.join(", ")
    );

    gmail = null;
    return false;
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      "http://localhost"
    );

    oauth2Client.setCredentials({
      refresh_token: REFRESH_TOKEN,
    });

    gmail = google.gmail({
      version: "v1",
      auth: oauth2Client,
    });

    return true;
  } catch (error) {
    gmail = null;
    console.error("Gmail configuration error:", error.message);
    return false;
  }
}

// --------------------------------------------------
// Normalize recipient emails and remove duplicates
// --------------------------------------------------
function normalizeEmails(value) {
  const items = Array.isArray(value) ? value : [value];

  return [
    ...new Set(
      items
        .flatMap((item) => String(item || "").split(/[,;\s]+/))
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

// --------------------------------------------------
// Encode email subject
// --------------------------------------------------
function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

// --------------------------------------------------
// Send one email using Gmail API
// --------------------------------------------------
async function sendWithGmail(recipient, subject, message) {
  if (!gmail) {
    throw new Error(
      "Gmail API is not configured. Check Render environment variables."
    );
  }

  const safeMessage = String(message)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const mimeMessage = [
    `From: BulkMail <${SENDER_EMAIL}>`,
    `To: ${recipient}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(safeMessage, "utf8").toString("base64"),
  ].join("\r\n");

  // Gmail API requires URL-safe Base64
  const raw = Buffer.from(mimeMessage, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return response.data.id || null;
}

// --------------------------------------------------
// Home route
// --------------------------------------------------
app.get("/", (req, res) => {
  res.json({
    message: "BulkMail Gmail API backend is running",
  });
});

// --------------------------------------------------
// Health check
// --------------------------------------------------
app.get("/health", (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;

  const gmailConfigured = Boolean(
    gmail &&
    CLIENT_ID &&
    CLIENT_SECRET &&
    REFRESH_TOKEN &&
    SENDER_EMAIL
  );

  res.status(200).json({
    server: "running",
    database: databaseConnected ? "connected" : "disconnected",
    emailService: gmailConfigured ? "configured" : "not configured",
  });
});

app.get("/api/health", (req, res) => {
  res.redirect("/health");
});

// --------------------------------------------------
// Send emails
// --------------------------------------------------
app.post("/sendmail", async (req, res) => {
  let record;

  try {
    const { emailList, subject, msg } = req.body || {};

    if (!subject || !String(subject).trim()) {
      return res.status(400).json({
        success: false,
        message: "Subject is required.",
      });
    }

    if (/[\r\n]/.test(String(subject))) {
      return res.status(400).json({
        success: false,
        message: "Subject contains invalid characters.",
      });
    }

    if (!msg || !String(msg).trim()) {
      return res.status(400).json({
        success: false,
        message: "Message is required.",
      });
    }

    if (!Array.isArray(emailList) && typeof emailList !== "string") {
      return res.status(400).json({
        success: false,
        message: "emailList must be an array or a string.",
      });
    }

    const recipients = normalizeEmails(emailList);

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Enter at least one recipient email address.",
      });
    }

    if (recipients.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Maximum 100 recipients per request.",
      });
    }

    const invalidEmails = recipients.filter(
      (email) => !EMAIL_REGEX.test(email)
    );

    if (invalidEmails.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid email addresses found.",
        invalidEmails,
      });
    }

    // Avoid accepting email requests if Gmail isn't configured
    if (!gmail) {
      return res.status(503).json({
        success: false,
        message:
          "Gmail API is not configured. Check backend environment variables.",
      });
    }

    // Save campaign history in MongoDB
    record = await Email.create({
      subject: String(subject).trim(),
      message: String(msg).trim(),
      recipients,
      sentTo: [],
      failedTo: [],
      status: "processing",
    });

    // Send individually to each recipient
    for (const recipient of recipients) {
      try {
        const messageId = await sendWithGmail(
          recipient,
          String(subject).trim(),
          String(msg).trim()
        );

        record.sentTo.push(recipient);

        console.log("Gmail accepted email:", {
          recipient,
          messageId: messageId || "not returned",
        });
      } catch (error) {
        record.failedTo.push(recipient);

        console.error("Gmail sending error:", {
          recipient,
          status: error.response?.status || "unknown",
          code: error.response?.data?.error?.status || "unknown",
          message:
            error.response?.data?.error?.message ||
            error.message ||
            "Email sending failed",
        });
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
      success: record.status === "sent",
      message:
        record.status === "sent"
          ? "Gmail accepted all email requests."
          : "Some emails failed. Check the backend logs.",
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
        record.status =
          record.sentTo?.length > 0 ? "partial" : "failed";
        await record.save();
      } catch (saveError) {
        console.error("History update failed:", saveError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Unable to process the email request.",
      historyId: record?._id,
    });
  }
});

// --------------------------------------------------
// Retrieve email history
// --------------------------------------------------
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

// --------------------------------------------------
// Connect MongoDB and start server
// --------------------------------------------------
async function startServer() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing.");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected successfully");

  const configured = configureGmail();

  if (configured) {
    console.log("Gmail API environment variables are loaded");
  } else {
    console.warn("Gmail API is not configured");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BulkMail server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});
