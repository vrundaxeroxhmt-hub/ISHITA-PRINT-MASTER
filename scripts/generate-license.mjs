import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=") || true]; }));
if (!args.machine) throw new Error("Usage: npm run license:generate -- --machine=MACHINE_CODE [--days=365] [--customer=Name]");
const issuedAt = new Date().toISOString();
let validityDays = null;
if (args.days) validityDays = Number(args.days);
else if (args.months) validityDays = Number(args.months) * 30;
else if (args.years) validityDays = Number(args.years) * 365;
if (validityDays !== null && (!Number.isFinite(validityDays) || validityDays <= 0)) throw new Error("Validity must be a positive number.");
const expiresAt = validityDays === null ? null : new Date(Date.now() + validityDays * 86400000).toISOString();
const payload = { product: "ISHTA PRINT MASTER", machine: String(args.machine).replace(/\s+/g, "").toUpperCase(), customer: String(args.customer || "Licensed Customer"), issuedAt, expiresAt };
const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
const privateKey = fs.readFileSync(path.join(process.cwd(), ".license-private", "license-private.pem"), "utf8");
const signature = crypto.sign(null, Buffer.from(encoded), privateKey).toString("base64url");
console.log(`PD1.${encoded}.${signature}`);
