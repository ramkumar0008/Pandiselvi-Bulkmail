
const mongoose = require("mongoose");

const emailSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
    },
    recipients: {
      type: [String],
      required: true,
    },
    successfulRecipients: {
      type: [String],
      default: [],
    },
    failedRecipients: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "sent", "partial", "failed"],
      default: "pending",
    },
    errorMessage: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Email", emailSchema);
