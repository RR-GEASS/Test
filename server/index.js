import { createApp } from "./app.js";
const port = Number(process.env.PORT || 3000);
const { app, close } = createApp({
  production: process.env.NODE_ENV !== "development",
});
const server = app.listen(port, "0.0.0.0", () =>
  console.log(`Cap SCI : serveur actif sur le port ${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      close();
      process.exit(0);
    }),
  );
