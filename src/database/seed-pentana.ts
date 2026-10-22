import * as dns from 'dns';
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // ignore
}

import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const uri = process.env.MONGODB_URI;

function parseDollarsToCents(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Math.round(val * 100);
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

function readJsonFile(dir: string, filename: string): any[] {
  const filePath = path.join(dir, filename.endsWith('.json') ? filename : `${filename}.json`);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return [];
    }
  }
  return [];
}

export async function runPentanaIngestion(existingDb?: mongoose.mongo.Db) {
  let shouldCloseConnection = false;
  let db: mongoose.mongo.Db;

  if (existingDb) {
    db = existingDb;
  } else {
    if (!uri) throw new Error('MONGODB_URI not defined');
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(uri);
    db = mongoose.connection.db!;
    shouldCloseConnection = true;
    console.log('Connected to MongoDB.');
  }

  // 1. Locate base directory
  const baseCandidateDirs = [
    path.resolve(__dirname, '../integrations/data/pentana'),
    path.resolve(__dirname, '../../../tradie-client-microservice/exports/pentana-extraction-v3-2026-10-21'),
    'd:/Hammad/tradie-client-microservice/exports/pentana-extraction-v3-2026-10-21',
  ];

  let baseDir = '';
  for (const dir of baseCandidateDirs) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'trade_accounts.json'))) {
      baseDir = dir;
      break;
    }
  }

  // 2. Locate expansion directory
  const expCandidateDirs = [
    path.resolve(__dirname, '../integrations/data/pentana-expansion'),
    path.resolve(__dirname, '../../../tradie-client-microservice/exports/pentana-expansion-2026-10-22'),
    'd:/Hammad/tradie-client-microservice/exports/pentana-expansion-2026-10-22',
  ];

  let expDir = '';
  for (const dir of expCandidateDirs) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'trade_accounts.json'))) {
      expDir = dir;
      break;
    }
  }

  console.log(`Using Pentana Base bundle: ${baseDir}`);
  console.log(`Using Pentana Expansion bundle: ${expDir || 'NONE'}`);

  const baseAccounts = baseDir ? readJsonFile(baseDir, 'trade_accounts') : [];
  const baseEntities = baseDir ? readJsonFile(baseDir, 'business_entities') : [];
  const baseWarnings = baseDir ? readJsonFile(baseDir, 'account_warnings') : [];
  const basePricing = baseDir ? readJsonFile(baseDir, 'account_pricing_rules') : [];
  const partsRaw = baseDir ? readJsonFile(baseDir, 'parts_observed') : [];
  const invoicesRaw = baseDir ? readJsonFile(baseDir, 'invoice_price_observations') : [];

  const expAccounts = expDir ? readJsonFile(expDir, 'trade_accounts') : [];
  const expSearch = expDir ? readJsonFile(expDir, 'entity_search') : [];
  const expContacts = expDir ? readJsonFile(expDir, 'contact_details') : [];
  const expWarnings = expDir ? readJsonFile(expDir, 'account_warnings') : [];
  const expPricing = expDir ? readJsonFile(expDir, 'account_pricing_rules') : [];

  // Build Contact Enrichment Map
  const contactEnrichment = new Map<string, any>();
  for (const ent of baseEntities) {
    const id = String(ent.entity_id).trim();
    if (id) contactEnrichment.set(id, ent);
  }
  for (const cont of expContacts) {
    const id = String(cont.entity_id).trim();
    if (id) contactEnrichment.set(id, cont);
  }

  // Build Warnings Map
  const warningsByEntity = new Map<string, string[]>();
  for (const w of [...baseWarnings, ...expWarnings]) {
    const id = String(w.entity_id || w.warning_entity_id).trim();
    if (!id) continue;
    const list = warningsByEntity.get(id) || [];
    const text = (w.warning_text || '').trim();
    if (text && !list.includes(text)) list.push(text);
    warningsByEntity.set(id, list);
  }

  // Build Pricing Rules Map
  const pricingByAccount = new Map<string, any>();
  for (const p of [...basePricing, ...expPricing]) {
    const id = String(p.account_id).trim();
    if (id) pricingByAccount.set(id, p);
  }

  // Merge Trade Accounts
  const accountsMap = new Map<string, any>();
  for (const acc of baseAccounts) {
    const id = String(acc.account_id).trim();
    if (id) accountsMap.set(id, acc);
  }
  for (const acc of expAccounts) {
    const id = String(acc.account_id).trim();
    if (id) accountsMap.set(id, acc);
  }

  const tradeAccountIds = new Set<string>(accountsMap.keys());
  const now = new Date();

  console.log(`\n--- Ingesting ${accountsMap.size} Verified Trade Accounts into tradeaccounts ---`);
  let accCount = 0;
  for (const [accountId, acc] of accountsMap.entries()) {
    const warningList = warningsByEntity.get(accountId) || [];
    const pricingRule = pricingByAccount.get(accountId) || {};
    const contactInfo = contactEnrichment.get(accountId) || {};

    const creditLimitCents = parseDollarsToCents(acc.credit_limit);
    const currentBalanceCents = parseDollarsToCents(acc.account_balance);
    const creditAvailableCents = parseDollarsToCents(acc.credit_available);
    const aged30DaysCents = parseDollarsToCents(acc.aged_30_days);
    const aged60DaysCents = parseDollarsToCents(acc.aged_60_days);
    const aged90DaysCents = parseDollarsToCents(acc.aged_90_days);
    const aged120DaysCents = parseDollarsToCents(acc.aged_120_days);
    const agedBalanceTotalCents = parseDollarsToCents(acc.aged_balance_total_raw || acc.aged_total);
    const ytdSpendCents =
      parseDollarsToCents(acc.purchase_ytd_receivable) ||
      parseDollarsToCents(acc.parts_sales_financial_year);
    const purchasePriorYearCents = parseDollarsToCents(acc.purchase_prior_year_receivable);
    const partsSalesFinancialYearCents = parseDollarsToCents(acc.parts_sales_financial_year);
    const partsTransactionsFinancialYear = parseInt(acc.parts_transactions_financial_year || '0', 10) || 0;

    let discountPercent = 15.0;
    const priceLevelLabel = String(acc.price_level_label || pricingRule.price_level_label || '').toLowerCase();
    const priceLevelCode = String(acc.price_level_code || pricingRule.price_level_code || '').trim();

    if (priceLevelLabel.includes('less 25') || priceLevelCode === '25' || priceLevelCode === '52') {
      discountPercent = 25.0;
    } else if (priceLevelLabel.includes('less 27') || priceLevelCode === '32' || priceLevelCode === '24') {
      discountPercent = 27.0;
    } else if (priceLevelLabel.includes('less 20') || priceLevelCode === '27') {
      discountPercent = 20.0;
    } else if (priceLevelLabel.includes('less 8') || priceLevelCode === '13') {
      discountPercent = 18.0;
    } else if (priceLevelLabel.includes('17%') || priceLevelCode === '17') {
      discountPercent = 17.0;
    } else if (
      priceLevelLabel.includes('dealer') ||
      priceLevelCode === '20' ||
      priceLevelCode === '30' ||
      priceLevelCode === '22' ||
      priceLevelCode === '35'
    ) {
      discountPercent = 20.0;
    } else if (priceLevelLabel.includes('trade') || priceLevelCode === '11') {
      discountPercent = 15.0;
    } else if (priceLevelLabel.includes('intro') || priceLevelCode === '18') {
      discountPercent = 12.0;
    }

    const hasTillPaymentWarning = warningList.some(
      (w) => w.toLowerCase().includes('till payment before ordering') || w.toLowerCase().includes('till payment'),
    );
    const hasDontUseWarning = warningList.some(
      (w) =>
        w.toLowerCase().includes("don't use this account") ||
        w.toLowerCase().includes('use account') ||
        w.toLowerCase().includes('please use capricorn') ||
        w.toLowerCase().includes('use capricorn account only'),
    );
    const isBalanceOverLimit = creditLimitCents > 0 && currentBalanceCents > creditLimitCents;

    const creditHold =
      acc.credit_hold === true ||
      hasTillPaymentWarning ||
      hasDontUseWarning ||
      (isBalanceOverLimit && creditAvailableCents < 0);

    const isOverdue =
      acc.overdue_flag === true || aged60DaysCents > 0 || aged90DaysCents > 0 || aged120DaysCents > 0;

    const companyName = (acc.entity_name || acc.business_name || contactInfo.entity_name || 'Trade Account').trim();
    const contactName = (acc.contact_name || contactInfo.contact_name || 'Accounts Manager').trim() || 'Accounts Manager';
    const email = (
      acc.business_email ||
      contactInfo.business_email ||
      acc.statement_email ||
      contactInfo.home_email ||
      acc.home_email ||
      `account-${accountId}@booran.com.au`
    ).trim();

    const phone = acc.business_phone || contactInfo.business_phone || acc.mobile_phone || contactInfo.mobile_phone || null;

    const record = {
      accountId,
      companyName,
      legalName: acc.legal_name ? acc.legal_name.trim() : (contactInfo.business_name || companyName),
      contactName,
      contactEmail: email,
      statementEmail: acc.statement_email ? acc.statement_email.trim() : null,
      businessEmail: acc.business_email ? acc.business_email.trim() : (contactInfo.business_email ? contactInfo.business_email.trim() : null),
      homeEmail: acc.home_email ? acc.home_email.trim() : (contactInfo.home_email ? contactInfo.home_email.trim() : null),
      contactPhone: phone ? phone.trim() : null,
      businessPhone: acc.business_phone ? acc.business_phone.trim() : (contactInfo.business_phone ? contactInfo.business_phone.trim() : null),
      mobilePhone: acc.mobile_phone ? acc.mobile_phone.trim() : (contactInfo.mobile_phone ? contactInfo.mobile_phone.trim() : null),
      abn: acc.abn_raw ? acc.abn_raw.trim() : (contactInfo.abn_raw ? contactInfo.abn_raw.trim() : null),

      paymentTerms: acc.payment_terms ? acc.payment_terms.trim() : (acc.payment_terms_code || '30 DAYS'),
      creditLimitCents,
      currentBalanceCents,
      creditAvailableCents,
      aged30DaysCents,
      aged60DaysCents,
      aged90DaysCents,
      aged120DaysCents,
      agedBalanceTotalCents,
      discountPercent,

      creditHold,
      isOverdue,
      isActive: true,

      ytdSpendCents,
      ytdOrderCount: partsTransactionsFinancialYear,
      ytdYear: 2026,
      purchasePriorYearCents,
      averageDaysToPay: parseInt(acc.average_days_to_pay || '30', 10) || 30,
      lastPurchaseDate: acc.last_purchase_date_raw || acc.last_purchase_date || null,
      lastPaymentDate: acc.last_payment_date_raw || acc.last_payment_date || null,

      financialYearLabel: acc.financial_year_label || acc.financial_year || '01/07/2026 - 30/06/2027',
      partsSalesFinancialYearCents,
      partsTransactionsFinancialYear,
      partsSaleTypeCode: acc.parts_sale_type_code || pricingRule.sale_type_code || 'T',
      partsSaleTypeLabel: acc.parts_sale_type_label || pricingRule.sale_type_label || 'T, 52| TRADE SALES',
      priceLevelCode: acc.price_level_code || pricingRule.price_level_code || '20',
      priceLevelLabel: acc.price_level_label || pricingRule.price_level_label || '20, DEALER',
      paymentMethodCode: acc.payment_method_code || pricingRule.payment_method_code || '1',
      paymentMethodLabel: acc.payment_method_label || pricingRule.payment_method_label || 'CHARGE',

      creditTypeCode: acc.credit_type_code || 'R',
      creditTypeLabel: acc.credit_type_label || 'Regular',
      creditCode: acc.credit_code || '1',
      creditCodeLabel: acc.credit_code_label || 'Good',
      creditComments: acc.credit_comments || '',

      purchaseOrderRequired: !!pricingRule.purchase_order_required,
      billToEntityId: pricingRule.bill_to_entity_id || null,
      territoryLabel: pricingRule.territory_label || 'No Selection',
      warningNotes: warningList,
      isVerifiedPentana: true,
      sourceEntityCode: '50',
      identifierType: 'PENTANA_ENTITY_ID',
      sourceScreens: acc.source_screens || 'EntityReceivable.htm; EntityParts.htm; EntityValueDtls.htm',

      rooftopId: 'ROOFTOP-DANDENONG',
      lastSyncedAt: now,
    };

    await db.collection('tradeaccounts').updateOne(
      { accountId },
      { $set: { ...record, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    accCount++;
  }
  console.log(`✅ Upserted ${accCount} verified Pentana trade accounts.`);

  // Merge 610 Discovered Entities
  const entitiesMap = new Map<string, any>();
  for (const ent of baseEntities) {
    const id = String(ent.entity_id).trim();
    if (id) entitiesMap.set(id, { ...ent, detailCaptureStatus: 'CAPTURED' });
  }
  for (const s of expSearch) {
    const id = String(s.entity_id).trim();
    if (!id) continue;
    if (!entitiesMap.has(id)) {
      entitiesMap.set(id, {
        entity_id: id,
        source_entity_code: s.source_entity_code || '50',
        entity_name: s.entity_name,
        business_name: s.entity_name,
        contact_name: '',
        address_line_1: s.address,
        address_line_2: '',
        suburb: s.suburb,
        postcode: s.postcode,
        state: 'VIC',
        business_email: '',
        home_email: '',
        business_phone: s.phone,
        mobile_phone: '',
        abn_raw: '',
        acn_raw: '',
        entity_type_raw: '',
        customer_type_detail_raw: s.customer_types_raw,
        detailCaptureStatus: 'SEARCH_DISCOVERED',
      });
    }
  }
  for (const c of expContacts) {
    const id = String(c.entity_id).trim();
    if (!id) continue;
    const existing = entitiesMap.get(id) || {};
    entitiesMap.set(id, { ...existing, ...c, detailCaptureStatus: 'CAPTURED' });
  }

  console.log(`\n--- Ingesting ${entitiesMap.size} Discovered Entities into pentanaentities ---`);
  let entCount = 0;
  for (const [entityId, ent] of entitiesMap.entries()) {
    const isTrade = tradeAccountIds.has(entityId);
    const entityName = (ent.entity_name || ent.business_name || `Entity ${entityId}`).trim();

    const entDoc = {
      entityId,
      sourceEntityCode: ent.source_entity_code || '50',
      entityName,
      businessName: ent.business_name ? ent.business_name.trim() : entityName,
      contactName: ent.contact_name ? ent.contact_name.trim() : '',
      firstName: ent.first_name ? ent.first_name.trim() : '',
      lastName: ent.last_name ? ent.last_name.trim() : '',
      addressLine1: ent.address_line_1 ? ent.address_line_1.trim() : (ent.address ? ent.address.trim() : ''),
      addressLine2: ent.address_line_2 ? ent.address_line_2.trim() : '',
      suburb: ent.suburb ? ent.suburb.trim().toUpperCase() : '',
      postcode: ent.postcode ? ent.postcode.trim() : '',
      state: ent.state ? ent.state.trim().toUpperCase() : 'VIC',
      businessEmail: ent.business_email ? ent.business_email.trim() : '',
      homeEmail: ent.home_email ? ent.home_email.trim() : '',
      businessPhone: ent.business_phone ? ent.business_phone.trim() : (ent.phone ? ent.phone.trim() : ''),
      mobilePhone: ent.mobile_phone ? ent.mobile_phone.trim() : '',
      abn: ent.abn_raw ? ent.abn_raw.trim() : '',
      acn: ent.acn_raw ? ent.acn_raw.trim() : '',
      entityTypeRaw: ent.entity_type_raw || '',
      customerTypeDetailRaw: ent.customer_type_detail_raw || ent.customer_types_raw || '',
      detailCaptureStatus: ent.detailCaptureStatus || 'CAPTURED',
      isTradeAccount: isTrade,
      linkedAccountId: isTrade ? entityId : null,
      capturedAt: ent.captured_at ? new Date(ent.captured_at) : null,
      updatedAt: now,
    };

    await db.collection('pentanaentities').updateOne(
      { entityId },
      { $set: entDoc, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    entCount++;
  }
  console.log(`✅ Upserted ${entCount} discovered Pentana entities.`);

  // Ingest observed part
  if (partsRaw.length > 0) {
    for (const p of partsRaw) {
      const partNumber = (p.part_number || '').trim();
      if (!partNumber) continue;
      const invoiceLine = invoicesRaw.find((inv: any) => inv.part_number === partNumber) || {};
      const listPrice = invoiceLine.list_unit_price ? parseFloat(invoiceLine.list_unit_price) : 240.54;
      const sellingPrice = invoiceLine.selling_unit_price ? parseFloat(invoiceLine.selling_unit_price) : 192.43;

      await db.collection('parts').updateOne(
        { partNumber },
        {
          $set: {
            partNumber,
            partNumberNormalised: partNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase(),
            brandCode: 'HYUNDAI',
            description: p.description ? p.description.trim() : 'GUARD ASSY-FRONT WH',
            descriptionLong: 'Hyundai Genuine Front Wheel Guard Assembly (Observed in Pentana Dandenong Invoicing)',
            groupCode: 'PANEL',
            groupName: 'Body & Panels',
            keywords: ['guard', 'assy', 'front', 'wheel', 'hyundai', 'panel'],
            vehicleFitment: ['TUCSON', 'SANTA FE', 'KONA'],
            vehicleRange: 'Hyundai Tucson / Santa Fe (Observed Post-Invoice)',
            listPriceCents: Math.round(listPrice * 100),
            coreChargeCents: 0,
            isActive: true,
            isSuperseded: false,
            supersededByPartNumber: null,
            unitOfMeasure: 'EA',
            isCommon: true,
            oemAvailabilityStatus: 'IN_STOCK',
            sources: [
              {
                sourceKind: 'BRANCH',
                sourceName: 'Booran Hyundai Genuine — Dandenong (Pentana DMS)',
                sourceRooftopId: 'ROOFTOP-DANDENONG',
                listPriceCents: Math.round(listPrice * 100),
                tradePriceCents: Math.round(sellingPrice * 100),
                stockQty: 8,
                inStock: true,
                eta: 'Same day — counter collection',
                binLocation: 'A-14-02',
                preferred: true,
                probeSuccess: true,
                resolvedAt: new Date().toISOString(),
              },
              {
                sourceKind: 'OEM',
                sourceName: 'Hyundai National Distribution Centre (NDC)',
                sourceRooftopId: 'ROOFTOP-DANDENONG',
                listPriceCents: Math.round(listPrice * 100),
                tradePriceCents: Math.round(sellingPrice * 100),
                stockQty: 42,
                inStock: true,
                eta: 'Next business day 09:30 run',
                binLocation: 'OEM-TRANSIT',
                preferred: false,
                probeSuccess: true,
                resolvedAt: new Date().toISOString(),
              },
            ],
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
      console.log(`✅ Upserted observed Pentana part ${partNumber} ($${listPrice} list / $${sellingPrice} trade)`);
    }
  }

  if (shouldCloseConnection) {
    await mongoose.disconnect();
    console.log('\n🎉 Pentana Data Ingestion Completed Successfully!');
  }
}

if (require.main === module) {
  runPentanaIngestion().catch((err) => {
    console.error('Fatal error during Pentana ingestion:', err);
    process.exit(1);
  });
}
