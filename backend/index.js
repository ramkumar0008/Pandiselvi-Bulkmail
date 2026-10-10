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

// Validate email addresses
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Configure Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Home route
app.get("/", (req, res) => {
  res.json({ message: "BulkMail API is running" });
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    server: "running",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

// Send bulk emails
app.post("/sendmail", async (req, res) => {
  let record;

  try {
    const { subject, body, recipients } = req.body;

    if (
      typeof subject !== "string" ||
      typeof body !== "string" ||
      !subject.trim() ||
      !body.trim() ||
      !Array.isArray(recipients)
    ) {
      return res.status(400).json({
        message: "Subject, message body and recipient list are required.",
      });
    }

    // Remove duplicate and empty email addresses
    const emails = [
      ...new Set(
        recipients
          .filter((email) => typeof email === "string")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean)
      ),
    ];

    if (emails.length === 0) {
      return res.status(400).json({
        message: "Add at least one recipient email.",
      });
    }

    // Limit each request to 10 recipients
    if (emails.length > 10) {
      return res.status(400).json({
        message: "Maximum 10 recipients per request.",
      });
    }

    const invalidEmails = emails.filter(
      (email) => !emailPattern.test(email)
    );

    if (invalidEmails.length > 0) {
      return res.status(400).json({
        message: "Some email addresses are invalid.",
        invalidEmails,
      });
    }

    // Save initial email history
    record = await Email.create({
      subject: subject.trim(),
      body: body.trim(),
      recipients: emails,
      status: "pending",
    });

    const successfulRecipients = [];
    const failedRecipients = [];

    // Send emails one at a time
    for (const recipient of emails) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: recipient,
          subject: subject.trim(),
          text: body.trim(),
        });

        successfulRecipients.push(recipient);
      } catch (error) {
        console.error(
          `Email send failed for ${recipient}:`,
          error.message
        );

        failedRecipients.push(recipient);
      }
    }

    // Update delivery status
    let status = "failed";

    if (successfulRecipients.length === emails.length) {
      status = "sent";
    } else if (successfulRecipients.length > 0) {
      status = "partial";
    }

    record.successfulRecipients = successfulRecipients;
    record.failedRecipients = failedRecipients;
    record.status = status;

    if (failedRecipients.length > 0) {
      record.errorMessage = "One or more messages could not be sent.";
    }

    await record.save();

    return res.status(200).json({
      message:
        status === "sent"
          ? "All emails submitted successfully."
          : status === "partial"
          ? "Some emails were sent; others failed."
          : "Email sending failed.",
      status,
      total: emails.length,
      sent: successfulRecipients.length,
      failed: failedRecipients.length,
      successfulRecipients,
      failedRecipients,
      recordId: record._id,
    });
  } catch (error) {
    console.error("Sendmail API error:", error.message);

    if (record) {
      try {
        record.status = "failed";
        record.errorMessage = error.message;
        await record.save();
      } catch (saveError) {
        console.error("History save failed:", saveError.message);
      }
    }

    return res.status(500).json({
      message: "Unable to process the email request.",
    });
  }
});

// Retrieve email history
app.get("/history", async (req, res) => {
  try {
    const history = await Email.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json(history);
  } catch (error) {
    console.error("History API error:", error.message);

    return res.status(500).json({
      message: "Unable to load email history.",
    });
  }
});

// Connect to MongoDB and start server
async function startServer() {
  try {
    if (
      !process.env.MONGO_URI ||
      !process.env.EMAIL_USER ||
      !process.env.EMAIL_PASS
    ) {
      throw new Error(
        "Missing MONGO_URI, EMAIL_USER or EMAIL_PASS environment variable."
      );
    }

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log("MongoDB connected successfully");

    await transporter.verify();
    console.log("Gmail SMTP connection verified");

    app.listen(PORT, () => {
      console.log(`BulkMail server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();