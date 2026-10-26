import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEmptyState,
  parseBackup,
  validateSettings,
  generateRecurringTransactions,
  monthEnd,
  todayISO,
} from "../src/model.js";
import {
  installAttachments,
  synchronizeAttachmentNames,
} from "./attachments.js";
import { installExports } from "./exports.js";
import { installEntityDocuments } from "./entity-documents.js";

const derive = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = "atelier_session";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function createApp({
  dbPath = resolve(
    process.env.SCI_DATA_DIR || resolve(root, "data"),
    "atelier.sqlite",
  ),
  production = process.env.NODE_ENV === "production",
  trustProxy = process.env.SCI_TRUST_PROXY === "1",
  authLimit = 30,
} = {}) {
  if (dbPath !== ":memory:")
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);`);
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          ...(production ? {} : { upgradeInsecureRequests: null }),
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", express.json({ limit: "8mb" }));
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    let allowed = false;
    try {
      const parsed = new URL(origin);
      allowed =
        parsed.host === req.get("host") &&
        parsed.protocol === `${req.protocol}:`;
    } catch {
      /* No origin is rejected for cookie-authenticated mutations. */
    }
    if (!allowed)
      return res
        .status(403)
        .json({ error: "Origine de la requête non autorisée." });
    next();
  });
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: production ? 30 : authLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Trop de tentatives. Réessayez dans 15 minutes." },
  });
  app.use(["/api/login", "/api/register"], limiter);
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: production,
    path: "/",
    maxAge: SESSION_MS,
  };
  function sessionToken(req) {
    const cookie = (req.get("cookie") || "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE}=`));
    const token = cookie?.slice(COOKIE.length + 1);
    return /^[a-f0-9]{64}$/.test(token || "") ? token : null;
  }
  function currentUser(req) {
    const token = sessionToken(req);
    if (!token) return null;
    return (
      db
        .prepare(
          "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?",
        )
        .get(digest(token), Date.now()) || null
    );
  }
  function requireUser(req, res, next) {
    const user = currentUser(req);
    if (!user)
      return res
        .status(401)
        .json({ error: "Connectez-vous pour accéder à votre SCI." });
    req.user = user;
    next();
  }
  function issueSession(req, res, user) {
    const old = sessionToken(req);
    if (old)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(old));
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    db.prepare(
      "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)",
    ).run(digest(token), user.id, Date.now() + SESSION_MS);
    res.cookie(COOKIE, token, cookieOptions);
  }
  function refreshRecurring(user) {
    const state = parseBackup(user.state);
    const before = JSON.stringify(state);
    generateRecurringTransactions(
      state,
      monthEnd(
        new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(
          new Date(),
        ),
      ),
    );
    if (JSON.stringify(state) !== before) {
      db.prepare(
        "UPDATE users SET state=?, revision=revision+1 WHERE id=? AND revision=?",
      ).run(JSON.stringify(state), user.id, user.revision);
      return db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
    }
    return user;
  }
  const payload = (user) => {
    user = refreshRecurring(user);
    return {
      user: { id: user.id, email: user.email },
      state: JSON.parse(user.state),
      revision: user.revision,
    };
  };
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/session", requireUser, (req, res) =>
    res.json(payload(req.user)),
  );
  installAttachments(app, db, requireUser);
  installEntityDocuments(app, db, requireUser);
  installExports(app, db, requireUser);
  app.post("/api/register", async (req, res, next) => {
    try {
      const { email, password, name } = req.body || {};
      if (
        typeof email !== "string" ||
        email.length > 254 ||
        !/^\S+@\S+\.\S+$/.test(email.trim()) ||
        typeof password !== "string" ||
        password.length < 12 ||
        password.length > 128
      )
        return res.status(400).json({
          error:
            "Saisissez un e-mail valide et un mot de passe de 12 à 128 caractères.",
        });
      const state = createEmptyState("IS");
      const settings = validateSettings({
        ...state.settings,
        name,
        openingBalance: "0",
      });
      if (Object.keys(settings.errors).length)
        return res.status(400).json({
          error: "Indiquez le nom de votre SCI (100 caractères maximum).",
        });
      state.settings = settings.value;
      const normalizedEmail = email.trim().toLowerCase();
      const salt = randomBytes(16).toString("hex");
      const hash = (await derive(password, salt, 64)).toString("hex");
      const id = randomBytes(16).toString("hex");
      try {
        db.prepare(
          "INSERT INTO users (id,email,password_hash,salt,state) VALUES (?,?,?,?,?)",
        ).run(id, normalizedEmail, hash, salt, JSON.stringify(state));
      } catch (error) {
        if (
          error.code === "ERR_SQLITE_ERROR" &&
          String(error.message).includes("UNIQUE")
        )
          return res
            .status(409)
            .json({ error: "Ce compte existe déjà. Connectez-vous." });
        throw error;
      }
      const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
      issueSession(req, res, user);
      res.status(201).json(payload(user));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/login", async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        email.length > 254 ||
        password.length > 128
      )
        return res.status(400).json({ error: "Identifiants invalides." });
      const user = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(email.trim().toLowerCase());
      const derived = await derive(
        password,
        user?.salt || "a-fixed-salt-for-timing-only",
        64,
      );
      if (
        !user ||
        !timingSafeEqual(derived, Buffer.from(user.password_hash, "hex"))
      )
        return res
          .status(401)
          .json({ error: "E-mail ou mot de passe incorrect." });
      issueSession(req, res, user);
      res.json(payload(user));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/logout", (req, res) => {
    const token = sessionToken(req);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  });
  app.put("/api/state", requireUser, (req, res) => {
    const { state: input, revision, accountId } = req.body || {};
    if (accountId !== req.user.id)
      return res.status(409).json({
        error:
          "Le compte connecté a changé. Reconnectez-vous au compte d’origine avant d’enregistrer ces modifications.",
        code: "account_changed",
      });
    if (!Number.isSafeInteger(revision) || revision < 0)
      return res.status(400).json({ error: "Version des données invalide." });
    let state;
    try {
      state = parseBackup(input);
      state.mode = "real";
      generateRecurringTransactions(
        state,
        monthEnd(
          new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(
            new Date(),
          ),
        ),
      );
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare("SELECT state,revision FROM users WHERE id=?").get(req.user.id);
      if (current?.revision === revision) {
        const previousLeases = new Map((JSON.parse(current.state).leases || []).map(l => [l.id, l]));
        if (state.leases.some(l => {
          const previous = previousLeases.get(l.id);
          return previous && (previous.tenantId !== l.tenantId || previous.propertyId !== l.propertyId);
        })) {
          db.exec("ROLLBACK");
          return res.status(409).json({ error: "Une location enregistrée doit conserver son bien et son locataire. Créez une nouvelle location pour préserver les documents et l’historique.", code: "lease_identity_changed" });
        }
      }
      const result = db
        .prepare(
          "UPDATE users SET state=?,revision=revision+1 WHERE id=? AND revision=?",
        )
        .run(JSON.stringify(state), req.user.id, revision);
      if (result.changes !== 1) {
        db.exec("ROLLBACK");
        return res.status(409).json({
          error:
            "Votre SCI a été modifiée sur un autre appareil. Exportez vos modifications puis rechargez les données.",
          code: "conflict",
        });
      }
      synchronizeAttachmentNames(db, req.user.id, state);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({ revision: revision + 1, state });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Adresse API introuvable." }),
  );
  if (production) {
    app.use(express.static(resolve(root, "dist"), { index: false }));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(root, "dist/index.html")),
    );
  }
  app.use((error, _req, res, _next) => {
    if (error.type === "entity.too.large")
      return res
        .status(413)
        .json({ error: "Le fichier est trop volumineux (8 Mo maximum)." });
    if (error instanceof SyntaxError)
      return res.status(400).json({ error: "Le JSON envoyé est invalide." });
    console.error("Erreur serveur :", error.code || error.name);
    res.status(500).json({
      error:
        "Une erreur serveur est survenue. Vos données précédemment enregistrées sont conservées.",
    });
  });
  return { app, close: () => db.close() };
}
