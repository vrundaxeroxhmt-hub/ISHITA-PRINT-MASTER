import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, "").split("="); return [key, value.join("=") || true]; }));
if (args.interactive) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  args.machine = await prompt.question("Enter Machine ID: ");
  prompt.close();
}
if (!args.machine) throw new Error("Usage: npm run license:generate -- --machine=MACHINE_CODE [--days=365] [--customer=Name]");
const machine = String(args.machine).replace(/\s+/g, "").toUpperCase();
if (!/^[A-F0-9]{20}$/.test(machine)) throw new Error("Machine ID must be exactly 20 hexadecimal characters (0-9 and A-F).");
const customer = String(args.customer || "Licensed Customer").trim();
if (!customer) throw new Error("Customer name is required.");
const issuedAt = args.issued ? new Date(String(args.issued)).toISOString() : new Date().toISOString();
let validityDays = null;
if (args.days) validityDays = Number(args.days);
else if (args.months) validityDays = Number(args.months) * 30;
else if (args.years) validityDays = Number(args.years) * 365;
if (validityDays !== null && (!Number.isFinite(validityDays) || validityDays <= 0)) throw new Error("Validity must be a positive number.");
const expiresAt = args.expires ? new Date(String(args.expires)).toISOString() : validityDays === null ? null : new Date(new Date(issuedAt).getTime() + validityDays * 86400000).toISOString();
if (expiresAt && new Date(expiresAt) <= new Date(issuedAt)) throw new Error("Expiry date must be after the issue date.");
const payload = { product: "SMART PRINT", machine, customer, licenseType: String(args["license-type"] || (expiresAt ? "Fixed Term" : "Lifetime")), issuedAt, expiresAt };
const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
const privateKey = fs.readFileSync(path.join(process.cwd(), ".license-private", "license-private.pem"), "utf8");
const signature = crypto.sign(null, Buffer.from(encoded), privateKey).toString("base64url");
const licenseKey = `PD1.${encoded}.${signature}`;
if (args.interactive) console.log("\nLicense Key:");
console.log(licenseKey);
