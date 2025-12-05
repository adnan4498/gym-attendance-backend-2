const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    feeSubmissionDate: { type: Date, required: true },
    trainer: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer" },
    photo: {
      data: String, // base64 string
      contentType: String, // 'image/jpeg', 'image/png', etc
      uploadedAt: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Client", clientSchema);