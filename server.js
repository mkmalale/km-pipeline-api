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

const app  = express();
const PORT = process.env.PORT || 3000;

// ── DATABASE ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

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

// ── HEALTH ────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

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
      "assigned_to","next_action","next_action_due"
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
    const { text, author = "Clerk" } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });
    const { rows } = await pool.query(
      `INSERT INTO notes (matter_id, text, author) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, text, author]
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
