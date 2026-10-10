require("dotenv").config();
const mongoose = require("mongoose");

async function testConnection() {
  const mongoURI = process.env.MONGO_URI || process.env.MONGO_URL;

  try {
    if (!mongoURI) {
      throw new Error(
        "MongoDB URI is missing. Check MONGO_URI in your .env file."
      );
    }

    console.log("Connecting to MongoDB Atlas...");

    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log("MongoDB Atlas connection successful!");
    console.log("Database:", mongoose.connection.name);
    console.log("Connection state:", mongoose.connection.readyState);
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);

    if (/bad auth|authentication failed/i.test(error.message)) {
      console.error(
        "Check your Atlas database username, password, and URI encoding."
      );
    } else if (/ENOTFOUND|querySrv/i.test(error.message)) {
      console.error(
        "Check your Atlas cluster hostname and DNS connection."
      );
    } else if (/timed out|server selection/i.test(error.message)) {
      console.error(
        "Check Atlas Network Access, your internet connection, and cluster status."
      );
    }

    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
    console.log("MongoDB connection closed.");
  }
}

testConnection();
