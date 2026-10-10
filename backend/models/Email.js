const mongoose = require("mongoose");

const emailSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    recipients: {
      type: [String],
      default: [],
    },
    sentTo: {
      type: [String],
      default: [],
    },
    failedTo: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["processing", "sent", "partial", "failed"],
      default: "processing",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Email", emailSchema);
