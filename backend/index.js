
require("dotenv").config();

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const Email = require("./models/Email");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let smtpReady = false;

// Gmail SMTP transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  requireTLS: true,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
  family: 4,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Home route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "BulkMail backend is running",
  });
});

// Health route
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    server: "running",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
    emailService: smtpReady ? "connected" : "unavailable",
  });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
    emailService: smtpReady ? "connected" : "unavailable",
  });
});

// Send bulk emails
app.post("/sendmail", async (req, res) => {
  try {
    const { emailList, subject, msg } = req.body;

    if (!Array.isArray(emailList) || emailList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one recipient email.",
      });
    }

    if (emailList.length > 10) {
      return res.status(400).json({
        success: false,
        message: "Maximum 10 recipients are allowed per request.",
      });
    }

    if (
      typeof subject !== "string" ||
      !subject.trim() ||
      typeof msg !== "string" ||
      !msg.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Subject and message are required.",
      });
    }

    const recipients = [
      ...new Set(
        emailList
          .filter((email) => typeof email === "string")
          .map((email) => email.trim().toLowerCase())
      ),
    ];

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid recipient emails were provided.",
      });
    }

    const invalidEmails = recipients.filter(
      (email) => !emailPattern.test(email)
    );

    if (invalidEmails.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Some email addresses are invalid.",
        invalidEmails,
      });
    }

    // Save the sending request in MongoDB
    const record = await Email.create({
      subject: subject.trim(),
      message: msg,
      recipients,
      sentTo: [],
      failedTo: [],
      status: "processing",
    });

    // SMTP is unavailable; retain the history record
    if (!smtpReady) {
      record.status = "failed";
      record.failedTo = recipients;
      await record.save();

      return res.status(503).json({
        success: false,
        message:
          "Email service is unavailable. The request was saved to history but no emails were sent.",
        recordId: record._id,
      });
    }

    const sentTo = [];
    const failedTo = [];

    // Send one email at a time
    for (const recipient of recipients) {
      try {
        await transporter.sendMail({
          from:
            '"' +
            "BulkMail" +
            '" <' +
            process.env.EMAIL_USER +
            ">",
          to: recipient,
          subject: subject.trim(),
          text: msg,
        });

        sentTo.push(recipient);
      } catch (error) {
        console.error(
          "Failed to send email to " + recipient + ":",
          error.message
        );
        failedTo.push(recipient);
      }
    }

    record.sentTo = sentTo;
    record.failedTo = failedTo;

    if (sentTo.length === recipients.length) {
      record.status = "sent";
    } else if (sentTo.length > 0) {
      record.status = "partial";
    } else {
      record.status = "failed";
    }

    await record.save();

    return res.status(200).json({
      success: failedTo.length === 0,
      message:
        failedTo.length === 0
          ? "All emails sent successfully."
          : "Email sending completed with some failures.",
      total: recipients.length,
      sent: sentTo.length,
      failed: failedTo.length,
      sentTo,
      failedTo,
      recordId: record._id,
    });
  } catch (error) {
    console.error("Send mail error:", error.message);

    return res.status(500).json({
      success: false,
      message: "An error occurred while processing emails.",
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

    res.status(200).json({
      success: true,
      count: history.length,
      history,
    });
  } catch (error) {
    console.error("History error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to retrieve email history.",
    });
  }
});

// Start the server after MongoDB connects
async function startServer() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing from environment variables.");
    }

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
    });

    console.log("MongoDB connected successfully");

    app.listen(PORT, "0.0.0.0", () => {
      console.log("BulkMail server running on port " + PORT);
    });

    // Verify SMTP separately so it cannot stop server startup
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error("Email credentials are missing.");
      return;
    }

    transporter
      .verify()
      .then(() => {
        smtpReady = true;
        console.log("Gmail SMTP connection verified");
      })
      .catch((error) => {
        smtpReady = false;
        console.error(
          "Gmail SMTP unavailable:",
          error.message
        );
      });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exitCode = 1;
  }
}

startServer();
