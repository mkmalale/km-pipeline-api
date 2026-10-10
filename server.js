/**
 * K MALALE ATTORNEYS INC — PIPELINE API SERVER
 * Stack: Node.js + Express + PostgreSQL
 * Deploy: Railway · Render · Heroku · any Node host
 * ─────────────────────────────────────────────
 * npm install express pg cors dotenv helmet express-rate-limit
 */

require("dotenv").config();
const express    = require("express");
const { Pool }   = require("pg");
const cors       = require("cors");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const crypto     = require("crypto");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── DATABASE ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// ── PIN HASHING ───────────────────────────────────────────────────
const PIN_PEPPER = process.env.PIN_PEPPER || "km-malale-pepper-2230";
function hashPin(pin) {
  return crypto.createHash("sha256").update(String(pin) + PIN_PEPPER).digest("hex");
}

// ── ENSURE users TABLE + SEED DEFAULTS ────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         BIGSERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'clerk' CHECK (role IN ('attorney','clerk')),
        pin_hash   TEXT NOT NULL,
        initials   TEXT,
        color      TEXT DEFAULT '#378ADD',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pin ON users(pin_hash);
    `);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM users");
    if (rows[0].c === 0) {
      await pool.query(
        `INSERT INTO users (name, role, pin_hash, initials, color) VALUES
         ($1,'attorney',$2,'KM','#9A7B4F'),
         ($3,'clerk',$4,'CL','#378ADD')`,
        ["Khongelani Malale", hashPin("2230"), "Clerk", hashPin("1234")]
      );
      console.log("Seeded default users.");
    }
  } catch (e) { console.error("users table init:", e.message); }
})();

// ── BILLING: rates + entries, note sentiment, seed from Fee Agreement 2025/6 ──
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_rates (
        id         BIGSERIAL PRIMARY KEY,
        category   TEXT NOT NULL,
        item       TEXT NOT NULL,
        unit       TEXT NOT NULL,
        amount     NUMERIC(10,2) NOT NULL,
        sort       INT DEFAULT 0,
        active     BOOLEAN DEFAULT true,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS billing_entries (
        id          BIGSERIAL PRIMARY KEY,
        matter_id   TEXT NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
        rate_id     BIGINT,
        category    TEXT,
        item        TEXT,
        unit        TEXT,
        qty         NUMERIC(10,2) DEFAULT 1,
        unit_amount NUMERIC(10,2) NOT NULL,
        amount      NUMERIC(10,2) NOT NULL,
        description TEXT,
        author      TEXT,
        billed      BOOLEAN DEFAULT false,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_billing_matter ON billing_entries(matter_id);
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS sentiment TEXT;
      ALTER TABLE matters ADD COLUMN IF NOT EXISTS court_date DATE;
      ALTER TABLE matters ADD COLUMN IF NOT EXISTS court_label TEXT;
      ALTER TABLE matters ADD COLUMN IF NOT EXISTS reminder_sent_for DATE;
      ALTER TABLE matters ADD COLUMN IF NOT EXISTS retainer_target NUMERIC(12,2);
      CREATE TABLE IF NOT EXISTS retainer_payments (
        id BIGSERIAL PRIMARY KEY,
        matter_id TEXT NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL,
        method TEXT, reference TEXT, author TEXT,
        received_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ret_matter ON retainer_payments(matter_id);
      CREATE TABLE IF NOT EXISTS calendar_events (
        id BIGSERIAL PRIMARY KEY,
        matter_id TEXT REFERENCES matters(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        event_date DATE NOT NULL,
        event_time TEXT,
        type TEXT DEFAULT 'appointment',
        notes TEXT, created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cal_date ON calendar_events(event_date);
    `);

    // Seed rates once from the Fee Agreement 2025/6
    const { rows: rc } = await pool.query("SELECT COUNT(*)::int AS c FROM billing_rates");
    if (rc[0].c === 0) {
      const R = [
        ["Consultation","Initial Consultation (In Person) — taking instruction & opening file","file",2500.00],
        ["Consultation","Initial Consultation (Virtual) — taking instruction & opening file","file",3000.00],
        ["Consultation","Consultation — per hour","hour",550.00],
        ["Pre-Trial","Pre-Trial — per hour [Attorney]","hour",550.00],
        ["Pre-Trial","Pre-Trial — per hour [Candidate Attorney/Paralegal]","hour",300.00],
        ["Inspection in Loco","Inspection in Loco — per hour [Attorney]","hour",550.00],
        ["Inspection in Loco","Inspection in Loco — per hour [Candidate Attorney/Paralegal]","hour",300.00],
        ["Inspection in Loco","Inspection in Loco — per hour [Assistant]","hour",150.00],
        ["Drawing & Drafting","Power of Attorney (per page)","page",100.00],
        ["Drawing & Drafting","Fee Agreement (per page)","page",100.00],
        ["Drawing & Drafting","General Drafting & Research (per page)","page",115.00],
        ["Drawing & Drafting","Confirmatory Affidavit (per 250 words)","250 words",100.00],
        ["Drawing & Drafting","Witness Statements (per 250 words)","250 words",200.00],
        ["Drawing & Drafting","Instruction to Counsel (per page)","page",100.00],
        ["Drawing & Drafting","Draw Pleadings (per 250 words)","250 words",250.00],
        ["Drawing & Drafting","Draw Notice i.t.o Rule 37(4) (per 250 words)","250 words",250.00],
        ["Drawing & Drafting","Draw Pre-Trial minutes (per 250 words)","250 words",250.00],
        ["Drawing & Drafting","Draw Notices (excl Rule 37(4)) (per 250 words)","250 words",100.00],
        ["Drawing & Drafting","Draw Notice of Motion (per page)","page",100.00],
        ["Drawing & Drafting","Draw Founding Affidavit (per page)","page",250.00],
        ["Drawing & Drafting","Draw Practice Note (per 250 words)","250 words",250.00],
        ["Letters & Emails","Send Email (per page)","page",50.00],
        ["Letters & Emails","Draw Letter (per page)","page",50.00],
        ["Letters & Emails","WhatsApp message (received and/or sent)","message",20.00],
        ["Perusal","Perusal — any document (per page)","page",15.00],
        ["Perusal","Peruse Email / Letter received (per page)","page",10.00],
        ["Index & Paginate","Index & Paginate [Attorney] (per 15 minutes)","15 min",250.00],
        ["Index & Paginate","Index & Paginate [Candidate Attorney] (per 15 minutes)","15 min",100.00],
        ["Miscellaneous","Making copies (per page)","page",4.50],
        ["Miscellaneous","Telephone call [Attorney] (per 5 min, rounded up)","5 min",50.00],
        ["Miscellaneous","Telephone call [Candidate Attorney] (per 5 min, rounded up)","5 min",25.00],
        ["Miscellaneous","Travelling Time [Attorney] (per minute)","minute",15.00],
        ["Miscellaneous","Travelling Disbursement (per km)","km",4.50],
        ["Execution","Writ of Execution — drafting, issuing & execution (excl disbursements)","item",950.00],
        ["Execution","Writ of Execution — re-issue","item",250.00],
      ];
      let i = 0;
      for (const [cat,item,unit,amt] of R) {
        await pool.query(
          "INSERT INTO billing_rates (category,item,unit,amount,sort) VALUES ($1,$2,$3,$4,$5)",
          [cat,item,unit,amt,i++]
        );
      }
      console.log("Seeded billing rates.");
    }

    // Back-date: give every existing matter an opening baseline entry if it has none
    const dep = await pool.query(
      "SELECT id, amount FROM billing_rates WHERE item LIKE 'Initial Consultation (In Person)%' LIMIT 1"
    );
    if (dep.rows.length) {
      await pool.query(`
        INSERT INTO billing_entries (matter_id, rate_id, category, item, unit, qty, unit_amount, amount, description, author)
        SELECT m.id, $1, 'Consultation', 'Opening of file (back-dated baseline)', 'file', 1, $2, $2,
               'Baseline entry created when billing was enabled', 'System'
        FROM matters m
        WHERE NOT EXISTS (SELECT 1 FROM billing_entries b WHERE b.matter_id = m.id)
      `, [dep.rows[0].id, dep.rows[0].amount]);
    }
  } catch (e) { console.error("billing init:", e.message); }
})();

// ── MIDDLEWARE ────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: [
    "https://www.malaleinc.co.za",
    "https://malaleinc.co.za",
    "http://localhost:3000",
    /\.malaleinc\.co\.za$/
  ],
  methods: ["GET","POST","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","x-api-key"],
}));

// Rate limiting
app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { error: "Too many requests — try again shortly." }
}));

// ── API KEY AUTH ──────────────────────────────────────────────────
const API_KEY = process.env.API_KEY || "km-pipeline-secret-change-me";
function auth(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (key !== API_KEY) return res.status(401).json({ error: "Unauthorised" });
  next();
}

// Attorney-only guard — verifies the acting user's role in the DB.
// Client sends x-user-id (obtained at PIN login). Rates & finance are gated here.
async function requireAttorney(req, res, next) {
  try {
    const uid = req.headers["x-user-id"];
    if (!uid) return res.status(403).json({ error: "Attorney access required" });
    const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [uid]);
    if (!rows.length || rows[0].role !== "attorney")
      return res.status(403).json({ error: "Attorney access required" });
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── EMAIL (Resend) — used for attorney alerts and client court reminders ──
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "kmalale@malaleinc.co.za";
const MAIL_FROM    = process.env.NOTIFY_FROM  || "K Malale Attorneys <onboarding@resend.dev>";
async function sendEmail(subject, html, to) {
  if (!process.env.RESEND_API_KEY) return false;   // email stays off until key is set
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [to || NOTIFY_EMAIL], subject, html,
                             reply_to: NOTIFY_EMAIL }),
    });
    return r.ok;
  } catch (e) { console.error("email error:", e.message); return false; }
}
function emailShell(title, bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #eee;border-radius:10px;overflow:hidden">
    <div style="background:#0d0d0d;padding:16px 20px"><span style="color:#C4A06A;font-size:18px;letter-spacing:1px">K&nbsp;MALALE&nbsp;ATTORNEYS</span><div style="color:rgba(255,255,255,.5);font-size:11px;letter-spacing:2px;text-transform:uppercase">Your Rights, Our Priority</div></div>
    <div style="padding:22px 20px;color:#1a1a1a;line-height:1.7;font-size:14px">
      <h2 style="font-size:17px;color:#9A7B4F;margin:0 0 12px">${title}</h2>
      ${bodyHtml}
    </div>
    <div style="background:#FAF7F2;padding:14px 20px;font-size:12px;color:#8a827a">
      K Malale Attorneys Inc · Office 10, Emerald Building, 6 Morgan Street, Tzaneen 0850<br>
      072 591 3980 · 082 613 2230 · kmalale@malaleinc.co.za · www.malaleinc.co.za
    </div>
  </div>`;
}

// ── HEALTH ────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ══════════════════════════════════════════════════════════════════
//  USERS & AUTH  (attorney-managed)
// ══════════════════════════════════════════════════════════════════

// helper: derive initials from a name
function initialsOf(name){
  const p = String(name).trim().split(/\s+/);
  return ((p[0]?.[0]||"") + (p[1]?.[0]||"")).toUpperCase() || "U";
}
const USER_COLORS = ["#9A7B4F","#378ADD","#1D9E75","#BA7517","#534AB7","#993C1D","#639922"];

// POST /api/auth/login {pin} — server-side PIN check, never ships PINs to client
app.post("/api/auth/login", auth, async (req, res) => {
  try {
    const pin = (req.body && req.body.pin) || "";
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: "PIN must be 4 digits" });
    const { rows } = await pool.query(
      "SELECT id, name, role, initials, color FROM users WHERE pin_hash = $1 LIMIT 1",
      [hashPin(pin)]
    );
    if (!rows.length) return res.status(401).json({ error: "Invalid PIN" });
    res.json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/users — list (never returns PINs)
app.get("/api/users", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, role, initials, color, created_at FROM users ORDER BY role DESC, name ASC"
    );
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/users — create {name, role, pin, color?}
app.post("/api/users", auth, async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.name || !/^\d{4}$/.test(d.pin || "")) return res.status(400).json({ error: "Name and a 4-digit PIN are required" });
    const role = d.role === "attorney" ? "attorney" : "clerk";
    // reject duplicate PIN
    const dup = await pool.query("SELECT 1 FROM users WHERE pin_hash = $1", [hashPin(d.pin)]);
    if (dup.rows.length) return res.status(409).json({ error: "That PIN is already in use" });
    const color = d.color || USER_COLORS[Math.floor(Math.random()*USER_COLORS.length)];
    const { rows } = await pool.query(
      `INSERT INTO users (name, role, pin_hash, initials, color)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, role, initials, color`,
      [d.name.trim(), role, hashPin(d.pin), initialsOf(d.name), color]
    );
    res.status(201).json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/users/:id — update {name?, role?, pin?, color?}
app.patch("/api/users/:id", auth, async (req, res) => {
  try {
    const d = req.body || {};
    const id = req.params.id;
    const cur = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    if (!cur.rows.length) return res.status(404).json({ error: "User not found" });

    // guard: never leave zero attorneys
    if (d.role && d.role !== "attorney" && cur.rows[0].role === "attorney") {
      const att = await pool.query("SELECT COUNT(*)::int AS c FROM users WHERE role='attorney'");
      if (att.rows[0].c <= 1) return res.status(400).json({ error: "At least one attorney must remain" });
    }
    const sets = [], params = [];
    if (d.name)  { params.push(d.name.trim()); sets.push(`name = $${params.length}`);
                   params.push(initialsOf(d.name)); sets.push(`initials = $${params.length}`); }
    if (d.role)  { params.push(d.role === "attorney" ? "attorney" : "clerk"); sets.push(`role = $${params.length}`); }
    if (d.color) { params.push(d.color); sets.push(`color = $${params.length}`); }
    if (d.pin)   {
      if (!/^\d{4}$/.test(d.pin)) return res.status(400).json({ error: "PIN must be 4 digits" });
      const dup = await pool.query("SELECT 1 FROM users WHERE pin_hash = $1 AND id <> $2", [hashPin(d.pin), id]);
      if (dup.rows.length) return res.status(409).json({ error: "That PIN is already in use" });
      params.push(hashPin(d.pin)); sets.push(`pin_hash = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    sets.push("updated_at = NOW()");
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}
       RETURNING id, name, role, initials, color`, params
    );
    res.json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/users/:id — cannot remove the last attorney
app.delete("/api/users/:id", auth, async (req, res) => {
  try {
    const cur = await pool.query("SELECT role FROM users WHERE id = $1", [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: "User not found" });
    if (cur.rows[0].role === "attorney") {
      const att = await pool.query("SELECT COUNT(*)::int AS c FROM users WHERE role='attorney'");
      if (att.rows[0].c <= 1) return res.status(400).json({ error: "Cannot delete the last attorney" });
    }
    await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    res.json({ deleted: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
//  MATTERS
// ══════════════════════════════════════════════════════════════════

// GET /api/matters — list all (with notes embedded)
app.get("/api/matters", auth, async (req, res) => {
  try {
    const { stage, search, limit = 200 } = req.query;
    let q = `
      SELECT m.*,
        COALESCE(
          JSON_AGG(n ORDER BY n.created_at ASC) FILTER (WHERE n.id IS NOT NULL),
          '[]'
        ) AS notes
      FROM matters m
      LEFT JOIN notes n ON n.matter_id = m.id
    `;
    const params = [];
    const conds  = [];
    if (stage)  { params.push(stage);  conds.push(`m.stage = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conds.push(`(m.first_name ILIKE $${params.length} OR m.last_name ILIKE $${params.length} OR m.phone ILIKE $${params.length} OR m.ref ILIKE $${params.length})`); }
    if (conds.length) q += " WHERE " + conds.join(" AND ");
    q += ` GROUP BY m.id ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));
    const { rows } = await pool.query(q, params);
    res.json({ data: rows, count: rows.length, ts: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/matters/:id — single matter with notes
app.get("/api/matters/:id", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*,
        COALESCE(JSON_AGG(n ORDER BY n.created_at ASC) FILTER (WHERE n.id IS NOT NULL),'[]') AS notes
      FROM matters m LEFT JOIN notes n ON n.matter_id = m.id
      WHERE m.id = $1 GROUP BY m.id
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/matters — create new matter
app.post("/api/matters", auth, async (req, res) => {
  try {
    const d = req.body;
    const ref = "KM-" + Math.random().toString(36).toUpperCase().slice(-6);
    const id  = d.id || ref;
    const { rows } = await pool.query(`
      INSERT INTO matters (
        id, ref, first_name, last_name, phone, email, town, id_number,
        matter_type, urgency, summary, consult_type, preferred_date, alt_date,
        time_slot, referral, assigned_to, next_action, next_action_due,
        stage, stage_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW()
      ) RETURNING *
    `, [
      id, ref,
      d.first_name || d.firstName, d.last_name || d.lastName,
      d.phone, d.email || null, d.town
