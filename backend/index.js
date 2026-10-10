
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const Email = require("./models/Email");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Email validation
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Gmail SMTP: port 587 with STARTTLS and IPv4 preference
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  requireTLS: true,
  family: 4,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 30000,
});

// Home route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "BulkMail API is running",
  });
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    server: "running",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

// Send bulk emails
app.post("/sendmail", async (req, res) => {
  try {
    const { subject, message, body, recipients, emails } = req.body;

    const emailSubject =
      typeof subject === "string" ? subject.trim() : "";

    const emailBody =
      typeof message === "string"
        ? message.trim()
        : typeof body === "string"
        ? body.trim()
        : "";

    const recipientInput = recipients ?? emails;

    let recipientList = [];

    if (Array.isArray(recipientInput)) {
      recipientList = recipientInput;
    } else if (typeof recipientInput === "string") {
      recipientList = recipientInput.split(/[\s,;]+/);
    }

    recipientList = [
      ...new Set(
        recipientList
          .map((email) =>
            typeof email === "string"
              ? email.trim().toLowerCase()
              : ""
          )
          .filter(Boolean)
      ),
    ];

    if (!emailSubject || !emailBody || recipientList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Subject, message, and recipients are required.",
      });
    }

    if (recipientList.some((email) => !emailPattern.test(email))) {
      return res.status(400).json({
        success: false,
        message: "One or more recipient email addresses are invalid.",
      });
    }

    if (recipientList.length > 10) {
      return res.status(400).json({
        success: false,
        message: "You can send a maximum of 10 recipients per request.",
      });
    }

    // Save the email request in MongoDB
    const record = await Email.create({
      subject: emailSubject,
      message: emailBody,
      recipients: recipientList,
      status: "processing",
    });

    const sentTo = [];
    const failedTo = [];

    // Send emails individually
    for (const recipient of recipientList) {
      try {
        await transporter.sendMail({
          from: `"BulkMail" <${process.env.EMAIL_USER}>`,
          to: recipient,
          subject: emailSubject,
          text: emailBody,
        });

        sentTo.push(recipient);
      } catch (error) {
        console.error(
          `Failed to send email to ${recipient}:`,
          error.message
        );

        failedTo.push(recipient);
      }
    }

    const finalStatus =
      failedTo.length === 0
        ? "sent"
        : sentTo.length === 0
        ? "failed"
        : "partial";

    record.status = finalStatus;
    record.sentTo = sentTo;
    record.failedTo = failedTo;

    await record.save();

    return res
      .status(failedTo.length === recipientList.length ? 502 : 200)
      .json({
        success: failedTo.length === 0,
        message:
          failedTo.length === 0
            ? "All emails sent successfully."
            : `${sentTo.length} email(s) sent; ${failedTo.length} failed.`,
        total: recipientList.length,
        sent: sentTo.length,
        failed: failedTo.length,
        sentTo,
        failedTo,
        historyId: record._id,
      });
  } catch (error) {
    console.error("Send mail error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to process the email request.",
    });
  }
});

// Get email history
app.get("/history", async (req, res) => {
  try {
    const history = await Email.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      success: true,
      count: history.length,
      history,
    });
  } catch (error) {
    console.error("History error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve email history.",
    });
  }
});

// Start server after checking MongoDB and Gmail
async function startServer() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing from environment variables.");
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error("EMAIL_USER or EMAIL_PASS is missing.");
    }

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
    });

    console.log("MongoDB connected successfully");

    await transporter.verify();
    console.log("Gmail SMTP connection verified");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`BulkMail server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
