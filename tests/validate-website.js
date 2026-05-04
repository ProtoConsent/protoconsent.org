#!/usr/bin/env node
// ProtoConsent browser extension
// Copyright (C) 2026 ProtoConsent contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Website validation for protoconsent.org
// Checks: CSP, no inline scripts/styles/handlers, CNAME, SDK demo,
// license headers, broken local links, schema, .well-known, directory.
//
// Usage: node tests/validate-website.js

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

let errors = 0;
let warnings = 0;

function fail(msg) {
  console.error("  FAIL:", msg);
  errors++;
}

function warn(msg) {
  console.warn("  WARN:", msg);
  warnings++;
}

function pass(msg) {
  console.log("  OK:", msg);
}

// Auto-discover all HTML files in repo
function findHtmlFiles(dir, base) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findHtmlFiles(full, rel));
    } else if (entry.name.endsWith(".html")) {
      results.push(rel.replace(/\\/g, "/"));
    }
  }
  return results;
}

const HTML_FILES = findHtmlFiles(ROOT, "");

// --- CNAME ---

function validateCNAME() {
  console.log("\n== CNAME ==");
  const cnamePath = path.join(ROOT, "CNAME");
  if (!fs.existsSync(cnamePath)) {
    fail("CNAME file missing (GitHub Pages custom domain)");
    return;
  }
  const cname = fs.readFileSync(cnamePath, "utf8").trim();
  if (cname !== "protoconsent.org") {
    fail(`CNAME is "${cname}", expected protoconsent.org`);
  } else {
    pass("CNAME: protoconsent.org");
  }
}

// --- CSP + inline checks per HTML file ---

function validateHtmlFiles() {
  console.log("\n== HTML files (" + HTML_FILES.length + " pages) ==");

  for (const relPath of HTML_FILES) {
    const filePath = path.join(ROOT, relPath);
    const content = fs.readFileSync(filePath, "utf8");

    // CSP meta tag
    if (!content.includes("Content-Security-Policy")) {
      fail(`${relPath}: missing Content-Security-Policy meta tag`);
    }

    // No inline scripts (scripts with body, not just src= references)
    const scriptRegex = /<script(?:\s[^>]*)?>[\s\S]+?<\/script>/gi;
    const scripts = content.match(scriptRegex) || [];
    let inlineCount = 0;
    for (const s of scripts) {
      if (/src\s*=/.test(s)) continue;
      inlineCount++;
    }
    if (inlineCount > 0) {
      fail(`${relPath}: ${inlineCount} inline <script> block(s)`);
    }

    // No inline event handlers (onclick, onload, etc.)
    const handlerRegex = /\bon\w+\s*=\s*["']/gi;
    if (handlerRegex.test(content)) {
      fail(`${relPath}: inline event handler found`);
    }

    // No inline style= attributes
    const styleAttrRegex = /\s+style\s*=\s*["'][^"']+["']/gi;
    const styleAttrs = content.match(styleAttrRegex) || [];
    if (styleAttrs.length > 0) {
      warn(`${relPath}: ${styleAttrs.length} inline style= attribute(s)`);
    }
  }

  pass(`${HTML_FILES.length} pages checked (CSP, inline scripts, handlers)`);
}

// --- Schema ---

function validateSchema() {
  console.log("\n== JSON Schema ==");
  const schemaPath = path.join(ROOT, "schema/v0.2.json");
  if (!fs.existsSync(schemaPath)) {
    fail("schema/v0.2.json not found");
    return null;
  }

  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } catch (e) {
    fail("schema/v0.2.json is not valid JSON: " + e.message);
    return null;
  }

  if (!schema.$schema) {
    fail("schema/v0.2.json missing $schema field");
  } else {
    pass("schema/v0.2.json: valid JSON Schema");
  }

  if (!schema.required || !schema.required.includes("protoconsent") || !schema.required.includes("purposes")) {
    fail("schema missing required fields (protoconsent, purposes)");
  } else {
    pass("schema requires protoconsent + purposes");
  }

  if (!schema.$defs || !schema.$defs.purposeEntry) {
    fail("schema missing $defs/purposeEntry");
  } else {
    pass("schema defines purposeEntry");
  }

  return schema;
}

// --- .well-known/protoconsent.json ---

function validateWellKnown(schema) {
  console.log("\n== .well-known/protoconsent.json ==");
  const wkPath = path.join(ROOT, ".well-known/protoconsent.json");
  if (!fs.existsSync(wkPath)) {
    fail(".well-known/protoconsent.json not found");
    return;
  }

  let wk;
  try {
    wk = JSON.parse(fs.readFileSync(wkPath, "utf8"));
  } catch (e) {
    fail(".well-known/protoconsent.json is not valid JSON: " + e.message);
    return;
  }

  // Validate required fields from schema
  if (wk.protoconsent !== "0.2") {
    fail(`.well-known: protoconsent field is "${wk.protoconsent}", expected "0.2"`);
  } else {
    pass(".well-known: protoconsent version 0.2");
  }

  if (!wk.purposes || typeof wk.purposes !== "object") {
    fail(".well-known: missing or invalid purposes object");
    return;
  }

  const KNOWN_PURPOSES = ["functional", "analytics", "ads", "personalization", "third_parties", "advanced_tracking"];
  const declared = Object.keys(wk.purposes);
  if (declared.length === 0) {
    fail(".well-known: purposes is empty");
  } else {
    pass(`.well-known: ${declared.length} purposes declared`);
  }

  // Each purpose must have "used" boolean
  for (const p of declared) {
    if (typeof wk.purposes[p].used !== "boolean") {
      fail(`.well-known: purpose "${p}" missing "used" boolean`);
    }
  }

  // Warn on unknown purposes
  for (const p of declared) {
    if (!KNOWN_PURPOSES.includes(p)) {
      warn(`.well-known: unknown purpose "${p}"`);
    }
  }

  // Validate legal_basis values if present
  const LEGAL_BASES = ["consent", "contractual", "legitimate_interest", "legal_obligation", "public_interest", "vital_interest"];
  for (const p of declared) {
    const entry = wk.purposes[p];
    if (entry.legal_basis && !LEGAL_BASES.includes(entry.legal_basis)) {
      fail(`.well-known: purpose "${p}" has invalid legal_basis "${entry.legal_basis}"`);
    }
  }

  pass(".well-known: structure valid");
}

// --- directory/sites.json ---

function validateDirectory() {
  console.log("\n== directory/sites.json ==");
  const dirPath = path.join(ROOT, "directory/sites.json");
  if (!fs.existsSync(dirPath)) {
    fail("directory/sites.json not found");
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(dirPath, "utf8"));
  } catch (e) {
    fail("directory/sites.json is not valid JSON: " + e.message);
    return;
  }

  if (!data.sites || !Array.isArray(data.sites)) {
    fail("directory/sites.json: missing or invalid sites array");
    return;
  }

  if (data.sites.length === 0) {
    fail("directory/sites.json: sites array is empty");
    return;
  }

  pass(`directory/sites.json: ${data.sites.length} sites`);

  // Validate each entry
  const domains = new Set();
  for (const site of data.sites) {
    if (!site.domain) {
      fail("directory: site entry missing domain");
      continue;
    }
    if (domains.has(site.domain)) {
      fail(`directory: duplicate domain "${site.domain}"`);
    }
    domains.add(site.domain);

    if (!site.version) {
      warn(`directory: "${site.domain}" missing version`);
    }
    if (typeof site.purposes !== "number") {
      warn(`directory: "${site.domain}" missing purposes count`);
    }
  }

  pass("directory: all entries valid, no duplicates");
}

// --- SDK demo ---

function validateSDK() {
  console.log("\n== SDK demo ==");
  const sdkPath = path.join(ROOT, "assets/js/sdk-demo.js");
  if (!fs.existsSync(sdkPath)) {
    fail("assets/js/sdk-demo.js not found");
    return;
  }

  const src = fs.readFileSync(sdkPath, "utf8");
  if (src.includes("ProtoConsent") || src.includes("protoconsent")) {
    pass("sdk-demo.js references ProtoConsent API");
  } else {
    fail("sdk-demo.js does not reference ProtoConsent");
  }

  // Check index.html loads it
  const indexPath = path.join(ROOT, "index.html");
  const index = fs.readFileSync(indexPath, "utf8");
  if (index.includes("sdk-demo.js")) {
    pass("index.html loads sdk-demo.js");
  } else {
    warn("index.html does not reference sdk-demo.js");
  }
}

// --- Broken local links ---

function validateLocalLinks() {
  console.log("\n== Local links ==");
  let broken = 0;

  for (const relPath of HTML_FILES) {
    const filePath = path.join(ROOT, relPath);
    const content = fs.readFileSync(filePath, "utf8");
    const dir = path.dirname(filePath);

    const linkRegex = /(?:href|src)\s*=\s*"([^"#]+)"/gi;
    let m;
    while ((m = linkRegex.exec(content)) !== null) {
      const ref = m[1];
      if (ref.startsWith("http") || ref.startsWith("//") || ref.startsWith("mailto:") || ref.startsWith("tel:") || ref.startsWith("data:") || ref.startsWith("/")) continue;
      const resolved = path.resolve(dir, ref.split("?")[0]);
      if (!fs.existsSync(resolved)) {
        fail(`${relPath}: broken link "${ref}"`);
        broken++;
      }
    }
  }

  if (broken === 0) {
    pass("No broken local links across " + HTML_FILES.length + " pages");
  }
}

// --- License headers ---

function validateLicenseHeaders() {
  console.log("\n== License headers ==");
  let missing = 0;

  for (const relPath of HTML_FILES) {
    const filePath = path.join(ROOT, relPath);
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.includes("SPDX-License-Identifier") && !content.includes("GPL-3.0")) {
      warn(`${relPath}: no license header`);
      missing++;
    }
  }

  if (missing === 0) {
    pass("All HTML files have license headers");
  }
}

// --- Main ---

console.log("ProtoConsent website validation");
console.log("Root:", ROOT);

validateCNAME();
validateHtmlFiles();
const schema = validateSchema();
validateWellKnown(schema);
validateDirectory();
validateSDK();
validateLocalLinks();
validateLicenseHeaders();

console.log("\n========================================");
if (errors > 0) {
  console.error(`RESULT: ${errors} error(s), ${warnings} warning(s)`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`RESULT: OK with ${warnings} warning(s)`);
} else {
  console.log("RESULT: All checks passed");
}
