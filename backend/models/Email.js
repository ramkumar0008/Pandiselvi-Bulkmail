
const mongoose = require("mongoose");

const emailSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
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
      index: true,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Email ||
  mongoose.model("Email", emailSchema);
