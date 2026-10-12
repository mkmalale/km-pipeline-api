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
  allowedHeaders: ["Content-Type","Authorization","x-api-key","x-user-id"],
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
      d.phone, d.email || null, d.town || null, d.id_number || d.idNumber || null,
      d.matter_type || d.matterType, d.urgency, d.summary,
      d.consult_type || d.consultType || "In-person · Tzaneen",
      d.preferred_date || d.preferredDate || null,
      d.alt_date || d.altDate || null,
      d.time_slot || d.timeSlot || null,
      d.referral || null,
      d.assigned_to || d.assignedTo || "Clerk",
      d.next_action || d.nextAction || "Contact client to confirm appointment",
      d.next_action_due || d.nextActionDue || null,
      d.stage || "inquiry"
    ]);
    // Auto-add system note if from website
    if (d.source === "website") {
      await pool.query(
        `INSERT INTO notes (matter_id, text, author) VALUES ($1, $2, 'System')`,
        [id, "Inquiry received via website booking form. WhatsApp sent to attorney."]
      );
      const m = rows[0];
      const urgent = (m.urgency||"").toLowerCase().includes("urgent");
      sendEmail(
        `${urgent?"🔴 URGENT — ":""}New inquiry — ${m.first_name} ${m.last_name||""}`,
        `<div style="font-family:sans-serif">
          <h2 style="color:#9A7B4F">New Client Inquiry</h2>
          <p><strong>${m.first_name} ${m.last_name||""}</strong> (${m.ref})</p>
          <p>Matter: ${m.matter_type||"—"}<br>Phone: ${m.phone||"—"}<br>Email: ${m.email||"—"}<br>Urgency: ${m.urgency||"—"}</p>
          <p>${m.summary||""}</p>
          <p style="color:#888;font-size:12px">Received ${new Date().toLocaleString("en-ZA")}</p>
        </div>`
      );
    }
    res.status(201).json({ data: { ...rows[0], notes: [] } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/matters/:id — update any fields
app.patch("/api/matters/:id", auth, async (req, res) => {
  try {
    const allowed = [
      "stage","stage_at","first_name","last_name","phone","email","town",
      "matter_type","urgency","summary","consult_type","preferred_date",
      "assigned_to","next_action","next_action_due","court_date","court_label","retainer_target"
    ];
    const d = req.body;
    const sets = [], params = [];
    // Normalise camelCase → snake_case
    const toSnake = k => k.replace(/([A-Z])/g, "_$1").toLowerCase();
    Object.entries(d).forEach(([k, v]) => {
      const col = toSnake(k);
      if (allowed.includes(col)) { params.push(v); sets.push(`${col} = $${params.length}`); }
    });
    if (!sets.length) return res.status(400).json({ error: "No valid fields to update" });
    // Auto set stage_at when stage changes
    if (Object.keys(d).includes("stage") && !Object.keys(d).includes("stage_at")) {
      sets.push("stage_at = NOW()");
    }
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE matters SET ${sets.join(",")} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    // Email notification on stage change
    if (Object.keys(d).map(k=>k.replace(/([A-Z])/g,"_$1").toLowerCase()).includes("stage")) {
      const m = rows[0];
      sendEmail(
        `Matter status changed — ${m.first_name} ${m.last_name||""}`,
        `<div style="font-family:sans-serif">
          <h2 style="color:#9A7B4F">K Malale Attorneys — Pipeline Update</h2>
          <p><strong>${m.first_name} ${m.last_name||""}</strong> (${m.ref}) moved to stage: <strong>${m.stage}</strong></p>
          <p>Matter type: ${m.matter_type||"—"}<br>Phone: ${m.phone||"—"}<br>Urgency: ${m.urgency||"—"}</p>
          <p style="color:#888;font-size:12px">Logged ${new Date().toLocaleString("en-ZA")}</p>
        </div>`
      );
    }
    res.json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/matters/:id
app.delete("/api/matters/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM matters WHERE id = $1", [req.params.id]);
    res.json({ deleted: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
//  NOTES
// ══════════════════════════════════════════════════════════════════

// POST /api/matters/:id/notes
app.post("/api/matters/:id/notes", auth, async (req, res) => {
  try {
    const { text, author = "Clerk", sentiment = null } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });
    const sv = ["positive","negative","neutral"].includes(sentiment) ? sentiment : null;
    const { rows } = await pool.query(
      `INSERT INTO notes (matter_id, text, author, sentiment) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, text, author, sv]
    );
    res.status(201).json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/notes/:id
app.delete("/api/notes/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM notes WHERE id = $1", [req.params.id]);
    res.json({ deleted: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
//  BILLING — rates (attorney-controlled) + entries + finance
// ══════════════════════════════════════════════════════════════════

// GET /api/rate-items — item list WITHOUT amounts (clerk can assign actions, not see money)
app.get("/api/rate-items", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, category, item, unit FROM billing_rates WHERE active = true ORDER BY sort ASC, id ASC"
    );
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rates — FULL rate card incl amounts (ATTORNEY ONLY)
app.get("/api/rates", auth, requireAttorney, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM billing_rates ORDER BY sort ASC, id ASC"
    );
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rates — add a custom rate (ATTORNEY ONLY)
app.post("/api/rates", auth, requireAttorney, async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.category || !d.item || !d.unit || d.amount == null)
      return res.status(400).json({ error: "category, item, unit and amount are required" });
    const { rows } = await pool.query(
      `INSERT INTO billing_rates (category,item,unit,amount,sort) VALUES ($1,$2,$3,$4,999) RETURNING *`,
      [d.category, d.item, d.unit, Number(d.amount)]
    );
    res.status(201).json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/rates/:id — change an amount/label (ATTORNEY ONLY)
app.patch("/api/rates/:id", auth, requireAttorney, async (req, res) => {
  try {
    const d = req.body || {};
    const sets = [], params = [];
    if (d.amount != null) { params.push(Number(d.amount)); sets.push(`amount = $${params.length}`); }
    if (d.item)   { params.push(d.item);   sets.push(`item = $${params.length}`); }
    if (d.unit)   { params.push(d.unit);   sets.push(`unit = $${params.length}`); }
    if (d.category){ params.push(d.category); sets.push(`category = $${params.length}`); }
    if (typeof d.active === "boolean") { params.push(d.active); sets.push(`active = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    sets.push("updated_at = NOW()");
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE billing_rates SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params
    );
    if (!rows.length) return res.status(404).json({ error: "Rate not found" });
    res.json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/rates/:id (ATTORNEY ONLY) — soft-deactivate to preserve history
app.delete("/api/rates/:id", auth, requireAttorney, async (req, res) => {
  try {
    await pool.query("UPDATE billing_rates SET active = false WHERE id = $1", [req.params.id]);
    res.json({ deactivated: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/matters/:id/billing — log a billable entry.
//   Clerk CAN create this (assign the action); the rate (amount) is pulled
//   server-side from the attorney-controlled table and cannot be overridden.
app.post("/api/matters/:id/billing", auth, async (req, res) => {
  try {
    const d = req.body || {};
    const qty = Number(d.qty) > 0 ? Number(d.qty) : 1;
    const { rows: rr } = await pool.query(
      "SELECT * FROM billing_rates WHERE id = $1 AND active = true", [d.rate_id]
    );
    if (!rr.length) return res.status(400).json({ error: "Unknown or inactive rate" });
    const rate = rr[0];
    const unit_amount = Number(rate.amount);        // locked — never from client
    const amount = Math.round(unit_amount * qty * 100) / 100;
    const { rows } = await pool.query(
      `INSERT INTO billing_entries
        (matter_id, rate_id, category, item, unit, qty, unit_amount, amount, description, author)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, rate.id, rate.category, rate.item, rate.unit, qty, unit_amount, amount,
       d.description || null, d.author || "Clerk"]
    );
    res.status(201).json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/matters/:id/billing — ledger + total for one file (ATTORNEY ONLY)
app.get("/api/matters/:id/billing", auth, requireAttorney, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM billing_entries WHERE matter_id = $1 ORDER BY created_at ASC", [req.params.id]
    );
    const total = rows.reduce((s,r)=>s+Number(r.amount),0);
    const billed = rows.filter(r=>r.billed).reduce((s,r)=>s+Number(r.amount),0);
    res.json({ data: rows, total, billed, wip: total - billed, count: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/billing/:id (ATTORNEY ONLY)
app.delete("/api/billing/:id", auth, requireAttorney, async (req, res) => {
  try {
    await pool.query("DELETE FROM billing_entries WHERE id = $1", [req.params.id]);
    res.json({ deleted: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/billing/:id — mark billed/unbilled or adjust qty (ATTORNEY ONLY)
app.patch("/api/billing/:id", auth, requireAttorney, async (req, res) => {
  try {
    const d = req.body || {};
    if (typeof d.billed === "boolean") {
      const { rows } = await pool.query(
        "UPDATE billing_entries SET billed = $1 WHERE id = $2 RETURNING *", [d.billed, req.params.id]
      );
      return res.json({ data: rows[0] });
    }
    res.status(400).json({ error: "Nothing to update" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/finance — totals per matter + grand totals (ATTORNEY ONLY)
app.get("/api/finance", auth, requireAttorney, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.ref, m.first_name, m.last_name, m.matter_type, m.stage,
             COALESCE(SUM(b.amount),0) AS total,
             COALESCE(SUM(CASE WHEN b.billed THEN b.amount ELSE 0 END),0) AS billed,
             COUNT(b.id) AS entries
      FROM matters m LEFT JOIN billing_entries b ON b.matter_id = m.id
      GROUP BY m.id ORDER BY total DESC
    `);
    const grand = rows.reduce((s,r)=>s+Number(r.total),0);
    const billed = rows.reduce((s,r)=>s+Number(r.billed),0);
    res.json({ data: rows, grand, billed, wip: grand - billed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
//  COURT-DATE REMINDERS — email the client 2 days before, with progress
//  Called daily by Vercel Cron (see vercel.json). Idempotent per date.
// ══════════════════════════════════════════════════════════════════
async function runReminders() {
  // matters with a court date exactly 2 days away, not yet reminded for it
  const { rows } = await pool.query(`
    SELECT m.*,
      (SELECT text FROM notes n WHERE n.matter_id = m.id ORDER BY n.created_at DESC LIMIT 1) AS last_note
    FROM matters m
    WHERE m.court_date = (CURRENT_DATE + INTERVAL '2 days')::date
      AND (m.reminder_sent_for IS DISTINCT FROM m.court_date)
  `);
  let sent = 0;
  for (const m of rows) {
    const when = new Date(m.court_date).toLocaleDateString("en-ZA", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
    const label = m.court_label || "court appearance";
    const name = `${m.first_name||""} ${m.last_name||""}`.trim();

    // 1) Client reminder + progress feedback
    if (m.email) {
      const body = `
        <p>Dear ${m.first_name || "Client"},</p>
        <p>This is a friendly reminder from K Malale Attorneys that your <strong>${label}</strong> is scheduled for:</p>
        <p style="font-size:16px;color:#0d0d0d;background:#FAEEDA;border-left:4px solid #9A7B4F;padding:10px 14px;border-radius:4px"><strong>${when}</strong></p>
        <p><strong>Matter reference:</strong> ${m.ref || m.id}<br><strong>Matter type:</strong> ${m.matter_type || "—"}</p>
        ${m.last_note ? `<p><strong>Latest progress on your case:</strong><br>${m.last_note}</p>` : ""}
        <p>Please ensure you are available and have any required documents ready. If you have questions, reply to this email or call us on 082 613 2230.</p>
        <p>Kind regards,<br><strong>K Malale Attorneys Inc</strong></p>`;
      await sendEmail(`Reminder: your ${label} on ${when}`, emailShell("Upcoming Court Date — 2 Days to Go", body), m.email);
      sent++;
    }
    // 2) Attorney copy
    await sendEmail(
      `Court reminder sent: ${name} — ${when}`,
      emailShell("Court date in 2 days", `<p><strong>${name}</strong> (${m.ref||m.id})<br>${label} on <strong>${when}</strong>.<br>Client ${m.email?("notified at "+m.email):"has no email on file — please phone "+(m.phone||"")}.</p>`),
      NOTIFY_EMAIL
    );
    await pool.query("UPDATE matters SET reminder_sent_for = court_date WHERE id = $1", [m.id]);
  }
  return { checked: rows.length, emailed: sent };
}

// GET /api/cron/reminders — Vercel Cron hits this daily.
// Auth: Vercel sends "Authorization: Bearer <CRON_SECRET>"; also accepts the API key for manual runs.
app.get("/api/cron/reminders", async (req, res) => {
  try {
    const bearer = (req.headers["authorization"] || "").replace("Bearer ", "");
    const ok = (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET)
            || (req.headers["x-api-key"] === API_KEY)
            || (req.query.key && req.query.key === (process.env.CRON_SECRET || API_KEY));
    if (!ok) return res.status(401).json({ error: "Unauthorised" });
    const result = await runReminders();
    res.json({ ok: true, ...result, ran_at: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/upcoming — court dates in the next 14 days (for the dashboard)
app.get("/api/upcoming", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, ref, first_name, last_name, matter_type, court_date, court_label,
             (court_date - CURRENT_DATE) AS days_away
      FROM matters
      WHERE court_date IS NOT NULL AND court_date >= CURRENT_DATE
            AND court_date <= (CURRENT_DATE + INTERVAL '30 days')::date
      ORDER BY court_date ASC
    `);
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
//  RETAINERS (trust deposits) — attorney-only money side
// ══════════════════════════════════════════════════════════════════
// GET /api/matters/:id/retainer — payments + used (from billing) + balance
app.get("/api/matters/:id/retainer", auth, requireAttorney, async (req, res) => {
  try {
    const pays = await pool.query("SELECT * FROM retainer_payments WHERE matter_id=$1 ORDER BY received_at ASC", [req.params.id]);
    const paid = pays.rows.reduce((s,r)=>s+Number(r.amount),0);
    const bill = await pool.query("SELECT COALESCE(SUM(amount),0) AS used FROM billing_entries WHERE matter_id=$1", [req.params.id]);
    const used = Number(bill.rows[0].used);
    const mt = await pool.query("SELECT retainer_target FROM matters WHERE id=$1", [req.params.id]);
    const target = mt.rows.length ? Number(mt.rows[0].retainer_target||0) : 0;
    res.json({ data: pays.rows, paid, used, balance: paid-used, target });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// POST /api/matters/:id/retainer — record a deposit (attorney)
app.post("/api/matters/:id/retainer", auth, requireAttorney, async (req, res) => {
  try {
    const d = req.body || {};
    if (!(Number(d.amount) > 0)) return res.status(400).json({ error: "A positive amount is required" });
    const { rows } = await pool.query(
      "INSERT INTO retainer_payments (matter_id, amount, method, reference, author) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [req.params.id, Number(d.amount), d.method||null, d.reference||null, d.author||"Attorney"]
    );
    res.status(201).json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// DELETE /api/retainer/:id (attorney)
app.delete("/api/retainer/:id", auth, requireAttorney, async (req, res) => {
  try { await pool.query("DELETE FROM retainer_payments WHERE id=$1", [req.params.id]); res.json({ deleted: req.params.id }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// GET /api/retainers — low-balance watch (attorney): files where balance < 25% of target (or <= 0)
app.get("/api/retainers", auth, requireAttorney, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.ref, m.first_name, m.last_name, m.matter_type, m.retainer_target,
        COALESCE((SELECT SUM(amount) FROM retainer_payments p WHERE p.matter_id=m.id),0) AS paid,
        COALESCE((SELECT SUM(amount) FROM billing_entries b WHERE b.matter_id=m.id),0) AS used
      FROM matters m WHERE m.stage <> 'closed'
    `);
    const data = rows.map(r=>({ ...r, balance: Number(r.paid)-Number(r.used) }))
      .filter(r=> Number(r.retainer_target)>0 && (r.balance <= 0 || r.balance < Number(r.retainer_target)*0.25))
      .sort((a,b)=>a.balance-b.balance);
    res.json({ data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
//  CALENDAR EVENTS (appointments / deadlines) — both roles may schedule
// ══════════════════════════════════════════════════════════════════
// ── iCalendar FEED — subscribe once, phone calendar auto-updates ──
// webcal://<host>/api/calendar.ics?key=<API_KEY>  (token in URL; calendar apps can't send headers)
function icsEsc(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/;/g,'\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n'); }
function icsDate(d){ const x=new Date(d); return x.getUTCFullYear()+String(x.getUTCMonth()+1).padStart(2,'0')+String(x.getUTCDate()).padStart(2,'0'); }
function icsFold(line){ // RFC5545 75-octet folding
  let out=''; while(line.length>73){ out+=line.slice(0,73)+'\r\n '; line=line.slice(73); } return out+line;
}
app.get("/api/calendar.ics", async (req, res) => {
  try {
    const key = req.query.key;
    if (key !== (process.env.ICS_TOKEN || API_KEY)) return res.status(401).send("Unauthorised");
    const events = [];
    // custom calendar events
    const ce = await pool.query("SELECT * FROM calendar_events ORDER BY event_date");
    ce.rows.forEach(e=>events.push({
      uid:'ev'+e.id, date:e.event_date, time:e.event_time, summary:e.title,
      desc:(e.notes||'')+(e.matter_id?(' [file '+e.matter_id+']'):''), type:e.type, alarm:true
    }));
    // derived from matters
    const ms = await pool.query("SELECT id, ref, first_name, last_name, matter_type, stage, court_date, court_label, next_action, next_action_due, preferred_date FROM matters WHERE stage <> 'closed'");
    ms.rows.forEach(m=>{
      const nm=((m.first_name||'')+' '+(m.last_name||'')).trim();
      if(m.court_date) events.push({uid:'court'+m.id,date:m.court_date,summary:(m.court_label||'Court')+' — '+nm,desc:'Court date · '+(m.ref||m.id)+' · '+(m.matter_type||''),type:'court',alarm:true});
      if(m.next_action_due) events.push({uid:'due'+m.id,date:m.next_action_due,summary:'Due: '+((m.next_action||'action'))+' — '+nm,desc:'Action due · '+(m.ref||m.id),type:'due',alarm:true});
      if(m.preferred_date && (m.stage==='inquiry'||m.stage==='booked')) events.push({uid:'cons'+m.id,date:m.preferred_date,summary:'Consultation — '+nm,desc:'Consultation · '+(m.ref||m.id),type:'consultation',alarm:true});
    });
    const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
    let out = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//K Malale Attorneys//Pipeline//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:K Malale Attorneys — Matters','X-WR-TIMEZONE:Africa/Johannesburg'];
    events.forEach(e=>{
      const start=icsDate(e.date);
      const end=icsDate(new Date(new Date(e.date).getTime()+86400000)); // all-day → next day
      out.push('BEGIN:VEVENT');
      out.push('UID:'+e.uid+'@malaleinc.co.za');
      out.push('DTSTAMP:'+stamp);
      if(e.time){ const t=e.time.replace(':','')+'00'; out.push('DTSTART;TZID=Africa/Johannesburg:'+start+'T'+t); }
      else { out.push('DTSTART;VALUE=DATE:'+start); out.push('DTEND;VALUE=DATE:'+end); }
      out.push(icsFold('SUMMARY:'+icsEsc(e.summary)));
      if(e.desc) out.push(icsFold('DESCRIPTION:'+icsEsc(e.desc)));
      out.push('CATEGORIES:'+(e.type||'event').toUpperCase());
      if(e.alarm){ out.push('BEGIN:VALARM','TRIGGER:-P2D','ACTION:DISPLAY','DESCRIPTION:Reminder (2 days)','END:VALARM'); out.push('BEGIN:VALARM','TRIGGER:-P1D','ACTION:DISPLAY','DESCRIPTION:Reminder (1 day)','END:VALARM'); }
      out.push('END:VEVENT');
    });
    out.push('END:VCALENDAR');
    res.set('Content-Type','text/calendar; charset=utf-8');
    res.set('Cache-Control','max-age=300');
    res.send(out.join('\r\n'));
  } catch (e) { res.status(500).send("Error: "+e.message); }
});

app.get("/api/calendar", auth, async (req, res) => {
  try {
    const from = req.query.from, to = req.query.to;
    let q = "SELECT * FROM calendar_events", params=[], cond=[];
    if (from){ params.push(from); cond.push("event_date >= $"+params.length); }
    if (to){ params.push(to); cond.push("event_date <= $"+params.length); }
    if (cond.length) q += " WHERE "+cond.join(" AND ");
    q += " ORDER BY event_date ASC, event_time ASC";
    const { rows } = await pool.query(q, params);
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/calendar", auth, async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.title || !d.event_date) return res.status(400).json({ error: "title and event_date are required" });
    const { rows } = await pool.query(
      `INSERT INTO calendar_events (matter_id, title, event_date, event_time, type, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [d.matter_id||null, d.title, d.event_date, d.event_time||null, d.type||"appointment", d.notes||null, d.created_by||"Clerk"]
    );
    res.status(201).json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/calendar/:id", auth, async (req, res) => {
  try { await pool.query("DELETE FROM calendar_events WHERE id=$1", [req.params.id]); res.json({ deleted: req.params.id }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STATS endpoint ────────────────────────────────────────────────
app.get("/api/stats", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE stage != 'closed') AS active,
        COUNT(*) FILTER (WHERE urgency LIKE 'Urgent%' AND stage != 'closed') AS urgent,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE stage = 'inquiry'   AND NOW() - stage_at > INTERVAL '1 day')  AS overdue_inquiry,
        COUNT(*) FILTER (WHERE stage = 'booked'    AND NOW() - stage_at > INTERVAL '3 days') AS overdue_booked,
        COUNT(*) FILTER (WHERE stage = 'progress'  AND NOW() - stage_at > INTERVAL '14 days') AS overdue_progress,
        COUNT(*) FILTER (WHERE stage = 'awaiting'  AND NOW() - stage_at > INTERVAL '7 days') AS overdue_awaiting
      FROM matters
    `);
    res.json({ data: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`KM Pipeline API running on port ${PORT}`));
