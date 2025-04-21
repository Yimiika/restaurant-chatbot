require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const Order = require("./models/Order");
const axios = require("axios");
//const db = require("./db");
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

app.set("views", "views");
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.json());

let orders = {};
let menu = [
  { id: 11, name: "Classic glazed doughnuts", price: 2500 },
  { id: 12, name: "Strawberry glazed doughnuts", price: 3000 },
  { id: 13, name: "Maple glazed dougnuts", price: 4000 },
  { id: 14, name: "Chocolate filled dougnuts", price: 2500 },
  { id: 15, name: "Jam filled dougnuts", price: 1900 },
  { id: 16, name: "Classic dougnuts with sprinkles", price: 4500 },
  { id: 17, name: "Classic doughnuts with chocolate shavings", price: 5000 },
];

app.get("/", (req, res) => {
  res.render("index");
});

// Payment success page
app.get("/payment-success", (req, res) => {
  res.render("payment-success");
});

app.post("/paystack-webhook", (req, res) => {
  const { event, data } = req.body;
  const reference = data.reference;

  if (event === "charge.success") {
    Order.findOne({ paystack_reference: reference })
      .then((order) => {
        if (order) {
          order.status = "completed";
          return order.save();
        }
      })
      .then(() => {
        res.status(200).send("Payment status updated to completed");
      })
      .catch((err) => {
        console.error("Error updating payment status", err);
        res.status(500).send("Internal server error");
      });
  } else {
    res.status(200).send("Webhook received, but not charge.success event");
  }
});

io.on("connection", (socket) => {
  console.log("a user connected");
  const welcomeMessage = `
  Welcome to May's Place!
  Please select an option:
  1️⃣  Select 1 to Place an order
  9️⃣9️⃣  Select 99 to Checkout order
  9️⃣8️⃣  Select 98 to See order history
  9️⃣7️⃣  Select 97 to See current order
  0️⃣  Select 0 to Cancel order
  `;

  socket.emit("message", welcomeMessage);

  socket.on("user-message", (message) => {
    const userId = socket.id;
    handleChatbotResponse(userId, message, socket);
  });

  socket.on("disconnect", () => {
    console.log("user disconnected");
  });

  socket.on("redirect", (url) => {
    window.location.href = url;
  });
});

function handleChatbotResponse(userId, message, socket) {
  switch (message) {
    case "1":
      let menuText = "Select an item to order:\n";
      menu.forEach((item) => {
        menuText += `${item.id}. ${item.name} - ₦${item.price}\n`;
      });
      socket.emit("message", menuText);
      orders[userId] = { status: "ordering", items: [] };
      break;

    case "99":
      if (orders[userId] && orders[userId].items.length > 0) {
        const total = calculateTotal(userId);
        const newOrder = new Order({
          userId,
          items: orders[userId].items,
          status: "ongoing",
          paystack_reference: "",
        });

        newOrder.save().then((savedOrder) => {
          socket.emit(
            "message",
            `Order placed. Total amount: ₦${total}. Proceeding to payment...`
          );
          initiatePayment(userId, socket, savedOrder._id, total);
        });
      } else {
        socket.emit("message", "No order to place, please add items to cart");
      }
      break;

    case "98":
      Order.find({ userId })
        .sort({ createdAt: -1 })
        .then((history) => {
          if (history.length === 0) {
            socket.emit("message", "No order history available.");
          } else {
            socket.emit("message", `Order History: ${JSON.stringify(history)}`);
          }
        });
      break;

    case "97":
      if (orders[userId] && orders[userId].status === "ordering") {
        let currentOrderText = "Your current order:\n";

        if (orders[userId].items.length > 0) {
          orders[userId].items.forEach((item, index) => {
            currentOrderText += `${index + 1}. ${item.name} - ₦${item.price}\n`;
          });
          currentOrderText += `\nTotal: ₦${calculateTotal(userId)}`;
        } else {
          currentOrderText =
            "Your current order is empty, please add items to cart.";
        }

        socket.emit("message", currentOrderText);
      } else {
        socket.emit("message", "No current order.");
      }
      break;

    case "0":
      orders[userId] = {};
      socket.emit("message", "Your order has been cancelled successfully.");
      break;

    default:
      const selectedItem = menu.find((item) => item.id === parseInt(message));
      if (selectedItem) {
        if (!orders[userId]) {
          orders[userId] = {
            status: "ordering",
            items: [],
          };
        }

        orders[userId].items.push(selectedItem);
        socket.emit("message", `${selectedItem.name} added to your order.`);
        socket.emit(
          "message",
          "Would you like to add something else or select 99 to checkout?"
        );
      } else {
        socket.emit(
          "message",
          "Invalid option. Please select a valid item or option."
        );
      }

      break;
  }
}

function calculateTotal(userId) {
  let total = 0;
  if (orders[userId] && orders[userId].items.length > 0) {
    orders[userId].items.forEach((item) => {
      total += item.price;
    });
  }
  return total;
}

function initiatePayment(userId, socket, orderId, totalAmount) {
  const amount = totalAmount * 100;
  const reference = `order_${orderId}_${Date.now()}`;
  const email = "testemail@example.com";

  const url = "https://api.paystack.co/transaction/initialize";
  const headers = {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  const data = {
    amount,
    email,
    reference,
    callback_url:
      "https://restaurant-chatbot-4mmu.onrender.com/payment-success",
  };

  axios
    .post(url, data, { headers })
    .then((response) => {
      if (
        response.data.status === true &&
        response.data.data.authorization_url
      ) {
        Order.findByIdAndUpdate(orderId, {
          paystack_reference: response.data.data.reference,
        })
          .then(() => {
            console.log(
              "Redirecting to: ",
              response.data.data.authorization_url
            );
            socket.emit("redirect", response.data.data.authorization_url);
          })
          .catch((err) => {
            console.error("Order update error:", err);
            socket.emit(
              "message",
              "Error updating order with Paystack reference."
            );
          });
      } else {
        console.error("Paystack response error:", response.data);
        socket.emit("message", "Error initiating payment. Please try again.");
      }
    })
    .catch((error) => {
      console.error("Paystack transaction error:", error);
      socket.emit("message", "Error initiating payment.");
    });
}

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
