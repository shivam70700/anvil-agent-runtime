import { config } from "./config.js";
import { app } from "./server.js";

const server = app.listen(config.PORT, () => {
  console.log(`Anvil API server listening on http://localhost:${config.PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, closing server...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, closing server...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});
