import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

async function main() {
  console.log("Seeding production organizations, RBAC users, and statutory rules...");

  // 1. Seed Organizations
  const orgDelhi = await prisma.organization.upsert({
    where: { code: "ORG-LM-DELHI" },
    update: {
      name: "Delhi Legal Metrology Enforcement Cell",
      jurisdiction: "National Capital Territory of Delhi",
    },
    create: {
      code: "ORG-LM-DELHI",
      name: "Delhi Legal Metrology Enforcement Cell",
      jurisdiction: "National Capital Territory of Delhi",
    },
  });

  const orgMaha = await prisma.organization.upsert({
    where: { code: "ORG-LM-MAHA" },
    update: {
      name: "Maharashtra Legal Metrology Department",
      jurisdiction: "State of Maharashtra",
    },
    create: {
      code: "ORG-LM-MAHA",
      name: "Maharashtra Legal Metrology Department",
      jurisdiction: "State of Maharashtra",
    },
  });

  console.log(`✓ Seeded Organizations: ${orgDelhi.code}, ${orgMaha.code}`);

  // 2. Seed Users (Only admin, officer, and reviewer)
  const users = [
    {
      organizationId: orgDelhi.id,
      username: "admin",
      password: "admin123",
      role: "ADMIN",
      name: "Chief Enforcement Controller",
      badgeNumber: "DL-LM-001",
    },
    {
      organizationId: orgDelhi.id,
      username: "officer",
      password: "officer123",
      role: "ENFORCEMENT_OFFICER",
      name: "Inspector Rajesh Sharma",
      badgeNumber: "DL-LM-104",
    },
    {
      organizationId: orgDelhi.id,
      username: "reviewer",
      password: "reviewer123",
      role: "REVIEWER",
      name: "Legal Officer Sunita Verma",
      badgeNumber: "DL-LM-R02",
    },
  ];

  // Purge any extra users not in the approved list
  const allowedUsernames = users.map((u) => u.username);
  const deleted = await prisma.user.deleteMany({
    where: { username: { notIn: allowedUsernames } },
  });
  if (deleted.count > 0) {
    console.log(`✓ Purged ${deleted.count} extra user account(s) from database.`);
  }

  for (const u of users) {
    const passwordHash = hashPassword(u.password);
    await prisma.user.upsert({
      where: { username: u.username },
      update: {
        organizationId: u.organizationId,
        passwordHash,
        role: u.role,
        name: u.name,
        badgeNumber: u.badgeNumber,
      },
      create: {
        organizationId: u.organizationId,
        username: u.username,
        passwordHash,
        role: u.role,
        name: u.name,
        badgeNumber: u.badgeNumber,
      },
    });
    console.log(`✓ Seeded user: ${u.username} (${u.role}) for org ${u.organizationId}`);
  }

  // 3. Seed Compliance Rules
  const statutoryRules = [
    {
      ruleId: "LM-PC-01",
      name: "Product Identity Declaration",
      description: "Commodity name or generic name must be clearly stated on the principal display panel.",
      field: "product_name",
      severity: "major",
      requirement: "The commodity name or common/generic name must be declared on the package.",
      referenceSection: "Rule 6(1)",
      sourceDocument: "Legal Metrology (Packaged Commodities) Rules, 2011",
      sourceUrl: "https://consumeraffairs.nic.in/acts-and-rules/legal-metrology",
    },
    {
      ruleId: "LM-PC-02",
      name: "Manufacturer / Packer / Importer Information",
      description: "Name and complete postal address of manufacturer, packer, or importer must be declared.",
      field: "manufacturer",
      severity: "critical",
      requirement: "Name and complete address of the manufacturer, packer, or importer must be declared.",
      referenceSection: "Rule 6(1)(a)",
      sourceDocument: "Legal Metrology (Packaged Commodities) Rules, 2011",
      sourceUrl: "https://consumeraffairs.nic.in/acts-and-rules/legal-metrology",
    },
    {
      ruleId: "LM-PC-03",
      name: "Net Quantity in Standard Units",
      description: "Net quantity must be declared in standard metric SI units (g, kg, ml, l, pcs).",
      field: "net_quantity",
      severity: "critical",
      requirement: "Net quantity must be present and expressed in a standard SI/metric unit (g, kg, ml, l, pcs).",
      referenceSection: "Rule 6(1)(b)",
      sourceDocument: "Legal Metrology (Packaged Commodities) Rules, 2011",
      sourceUrl: "https://consumeraffairs.nic.in/acts-and-rules/legal-metrology",
    },
    {
      ruleId: "LM-PC-04",
      name: "Maximum Retail Price (MRP)",
      description: "Retail sale price with ₹ / Rs / INR symbol and inclusive of all taxes must be declared.",
      field: "mrp",
      severity: "critical",
      requirement: "The retail sale price must be declared with a recognizable Indian currency marker (₹ / Rs / INR) and numeric amount.",
      referenceSection: "Rule 6(1)(e)",
      sourceDocument: "Legal Metrology (Packaged Commodities) Rules, 2011",
      sourceUrl: "https://consumeraffairs.nic.in/acts-and-rules/legal-metrology",
    },
    {
      ruleId: "LM-PC-05",
      name: "Date of Manufacture / Packing / Import",
      description: "Month and year of manufacture, packing, or import must be clearly printed.",
      field: "date",
      severity: "critical",
      requirement: "Month and year of manufacture, packing, or import must be declared.",
      referenceSection: "Rule 6(1)(d)",
      sourceDocument: "Legal Metrology (Packaged Commodities) Rules, 2011",
      sourceUrl: "https://consumeraffairs.nic.in/acts-and-rules/legal-metrology",
    },
    {
      ruleId: "LM-PC-06",
      name: "Consumer Care Details",
      description: "Name, address, telephone number, or email address of the person/office to be contacted in case of complaints.",
      field: "consumer_care",
      severity: "major",
      requirement: "Consumer care details including telephone/toll-free or email/address must be declared.",
      referenceSection: "Rule 6(1)(f)",
      sourceDocument: "Legal Metrology (Packaged Commodities) Rules, 2011",
      sourceUrl: "https://consumeraffairs.nic.in/acts-and-rules/legal-metrology",
    },
    {
      ruleId: "LM-PC-07",
      name: "Country of Origin",
      description: "Country of origin must be declared for imported or packaged commodities.",
      field: "country_of_origin",
      severity: "major",
      requirement: "Country of origin must be explicitly stated.",
      referenceSection: "Rule 6(10)",
      sourceDocument: "Legal Metrology (Packaged Commodities) Rules, 2011",
      sourceUrl: "https://consumeraffairs.nic.in/acts-and-rules/legal-metrology",
    },
  ];

  for (const rule of statutoryRules) {
    await prisma.complianceRule.upsert({
      where: { ruleId: rule.ruleId },
      update: rule,
      create: rule,
    });
  }
  console.log(`✓ Seeded ${statutoryRules.length} statutory compliance rules.`);

  console.log("Seeding completed successfully.");
}

main()
  .catch((e) => {
    console.error("Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

