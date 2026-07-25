import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const privateDir = path.join(root, ".license-private");
const privatePath = path.join(privateDir, "license-private.pem");
const publicPath = path.join(root, "electron", "license-public.pem");
if (!fs.existsSync(privatePath) || !fs.existsSync(publicPath)) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(privateDir, { recursive: true });
  fs.writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));
  console.log("Created PrintDesk licence signing keys. Keep .license-private secure and backed up.");
} else console.log("Licence signing keys already exist.");
