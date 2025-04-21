const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  userId: String,
  items: [
    {
      id: Number,
      name: String,
      price: Number,
    },
  ],
  status: {
    type: String,
    enum: ["ongoing", "completed", "cancelled"],
    default: "ongoing",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Order", orderSchema);
